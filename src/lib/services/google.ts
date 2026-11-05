import crypto from "node:crypto";
import type { Database } from "../db";
import { users, type CustomerType, type User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { signToken, verifyToken } from "../crypto";
import { audit } from "./audit";
import { createCustomerAccount, findUserByEmail, normalizeEmail } from "./users";
import { eq } from "drizzle-orm";
import type { Locale } from "../i18n/config";

/** Google sign-in: OAuth 2.0 authorization-code flow with state and PKCE. */

export const GOOGLE_STATE_COOKIE = "cm_google_oauth";

/**
 * One cookie per sign-in attempt, named after its state. With a single shared cookie, starting Google sign-in in
 * a second tab (or clicking twice) replaced the first attempt's cookie, and finishing the first then failed.
 */
export function googleStateCookieName(state: string | null | undefined) {
  const id = (state ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  return id ? `${GOOGLE_STATE_COOKIE}_${id}` : GOOGLE_STATE_COOKIE;
}
export const GOOGLE_SIGNUP_COOKIE = "cm_google_signup";

export function googleEnabled() {
  return !!(env.googleClientId && env.googleClientSecret);
}

export function googleRedirectUri() {
  return `${env.appUrl}/api/auth/google/callback`;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Calendar access for meetings: free/busy times and events (with Google Meet links) on the primary calendar. */
export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];

/**
 * Builds the Google consent URL and the signed state cookie value (state, PKCE verifier, return path).
 * With `calendarFor`, it's a team member connecting their Google Calendar instead of signing in: calendar scopes,
 * offline access (a refresh token), and the same redirect URI, so no extra setup in Google Cloud.
 */
export function startGoogleSignIn(next: string | null, opts: { calendarFor?: string } = {}) {
  if (!googleEnabled()) throw new AppError("not_found");
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: ["openid", "email", "profile", ...(opts.calendarFor ? CALENDAR_SCOPES : [])].join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(opts.calendarFor ? { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } : { prompt: "select_account" }),
  }).toString();
  const cookie = signToken(JSON.stringify({ state, verifier, next: safeNext, ...(opts.calendarFor ? { calendarFor: opts.calendarFor } : {}) }), 600);
  return { url: url.toString(), cookie, cookieName: googleStateCookieName(state) };
}

export type GoogleProfile = { email: string; emailVerified: boolean; name: string; sub: string };

/** Exchanges the authorization code (validating state) and fetches the verified profile. */
export async function finishGoogleSignIn(params: { code: string | null; state: string | null; cookie: string | undefined }) {
  const raw = params.cookie ? verifyToken(params.cookie) : null;
  const saved = raw ? (JSON.parse(raw) as { state: string; verifier: string; next: string | null; calendarFor?: string }) : null;
  if (!saved || !params.state || saved.state !== params.state || !params.code) {
    // Which check failed, for the server log (no secrets): no cookie, expired/forged cookie, or another attempt's cookie.
    const why = !params.cookie ? "no state cookie" : !raw ? "state cookie expired or invalid" : !params.code ? "no code" : "state does not match";
    throw new AppError("forbidden", `Invalid OAuth state (${why})`, { reason: "state" });
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) {
    // Google's error code/description (e.g. invalid_client, redirect_uri_mismatch) — contains no secrets.
    const detail = await tokenRes.text().catch(() => "");
    throw new AppError("unauthorized", `Google token exchange failed (${tokenRes.status}): ${detail.slice(0, 300)}`, { reason: "token" });
  }
  const token = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!infoRes.ok) throw new AppError("unauthorized", "Google profile request failed", { reason: "profile" });
  const info = (await infoRes.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.email) throw new AppError("unauthorized", "Google account has no email");
  const profile = { email: normalizeEmail(info.email), emailVerified: !!info.email_verified, name: info.name ?? "", sub: info.sub } as GoogleProfile;
  // Connecting a calendar: the granted scopes and the refresh token, for the user who started it.
  const calendar = saved.calendarFor
    ? { userId: saved.calendarFor, refreshToken: token.refresh_token ?? null, scopesGranted: CALENDAR_SCOPES.every((sc) => (token.scope ?? "").split(" ").includes(sc)) }
    : null;
  return { profile, next: saved.next, calendar };
}

/**
 * Existing accounts sign in directly; a new email returns a short-lived signed token so the person can
 * accept the terms and choose a customer type before the account is created.
 */
export async function resolveGoogleUser(db: Database, profile: GoogleProfile): Promise<{ user: User } | { pendingToken: string }> {
  if (!profile.emailVerified) throw new AppError("unauthorized", "Google email is not verified", { reason: "unverified" });
  const user = await findUserByEmail(db, profile.email);
  if (user) {
    if (user.status === "disabled") throw new AppError("account_disabled");
    const patch: Partial<User> = { lastLoginAt: new Date(), ...(user.status === "invited" ? { status: "active" as const } : {}) };
    await db.update(users).set(patch).where(eq(users.id, user.id));
    await audit(db, { actorId: user.id, action: "auth.login_google", entityType: "user", entityId: user.id });
    return { user: { ...user, ...patch } };
  }
  return { pendingToken: signToken(JSON.stringify({ email: profile.email, name: profile.name }), 1800) };
}

export function readPendingGoogleSignup(token: string | undefined): { email: string; name: string } | null {
  const raw = token ? verifyToken(token) : null;
  return raw ? (JSON.parse(raw) as { email: string; name: string }) : null;
}

export async function completeGoogleSignup(
  db: Database,
  token: string | undefined,
  input: { name: string; phone?: string | null; customerType: CustomerType; organizationName?: string | null; organizationNumber?: string | null; acceptTerms: boolean; aiConsent: boolean; locale: Locale },
): Promise<User> {
  const pending = readPendingGoogleSignup(token);
  if (!pending) throw new AppError("code_expired");
  if (!input.acceptTerms) throw new AppError("terms_required");
  if (await findUserByEmail(db, pending.email)) throw new AppError("conflict");
  return db.transaction((tx) =>
    createCustomerAccount(tx, {
      email: pending.email,
      name: input.name.trim() || pending.name,
      phone: input.phone,
      locale: input.locale,
      customerType: input.customerType,
      organizationName: input.organizationName,
      organizationNumber: input.organizationNumber,
      aiConsent: input.aiConsent,
    }),
  );
}
