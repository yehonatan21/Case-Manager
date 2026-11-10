import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users, type User } from "../db/schema";
import { randomToken, sha256 } from "../crypto";
import { env } from "../env";
import { AppError } from "../errors";
import { canOpenPage, type StaffPage } from "./permissions";
import { isStaffRole } from "../domain";

export const SESSION_COOKIE = "cm_session";
const SESSION_DAYS = 30;

const sessionRow = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ user: users, mfaPending: sessions.mfaPending })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status === "disabled") return null;
  return row;
});

/** The signed-in user. A sign-in still waiting for its second step (the authenticator app) doesn't count. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const row = await sessionRow();
  return row && !row.mfaPending ? row.user : null;
});

/** The user of a sign-in that's waiting for the code from their authenticator app. */
export async function getPendingSecondStepUser(): Promise<User | null> {
  const row = await sessionRow();
  return row?.mfaPending ? row.user : null;
}

/** The second step was passed: the session becomes a full sign-in. */
export async function completeSecondStep() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await getDb();
  await db.update(sessions).set({ mfaPending: false }).where(eq(sessions.tokenHash, sha256(token)));
}

export async function createSession(userId: string, opts: { mfaPending?: boolean } = {}) {
  const db = await getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt, userAgent: ua, mfaPending: !!opts.mfaPending });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** For pages: redirect to sign-in when there's no session. */
export async function requirePageUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/** The account page, where a team member sets up two-step sign-in when the office requires it. */
export const ACCOUNT_PATH = "/admin/account";

async function mustSetUpSecondStep(user: User): Promise<boolean> {
  if (user.totpEnabledAt || !isStaffRole(user.role)) return false;
  const { getSettings } = await import("../services/settings");
  return (await getSettings(await getDb())).require_staff_2fa;
}

/**
 * For staff pages. When the office requires two-step sign-in and this team member hasn't set it up, they're sent
 * to My account first (the layout passes `allowWithoutSecondStep`, so My account itself still renders).
 */
export async function requirePageStaff(nextPath: string, opts: { allowWithoutSecondStep?: boolean } = {}): Promise<User> {
  const user = await requirePageUser(nextPath);
  if (!isStaffRole(user.role)) redirect("/portal");
  if (!opts.allowWithoutSecondStep && !nextPath.startsWith(ACCOUNT_PATH) && (await mustSetUpSecondStep(user))) redirect(`${ACCOUNT_PATH}?setup=1`);
  return user;
}

/** A staff page with its own access rule (see STAFF_PAGES): anyone else on the team is sent to the dashboard. */
export async function requireStaffPage(nextPath: string, page: StaffPage, opts: { allowWithoutSecondStep?: boolean } = {}): Promise<User> {
  const user = await requirePageStaff(nextPath, opts);
  if (!canOpenPage(user.role, page)) redirect(page === "newCase" ? "/admin/cases" : "/admin");
  return user;
}

export async function requirePageCustomer(nextPath: string): Promise<User> {
  const user = await requirePageUser(nextPath);
  if (isStaffRole(user.role)) redirect("/admin");
  return user;
}

/** For API routes: throw a 401/403 AppError. */
export async function requireApiUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthorized");
  return user;
}

/** `allowWithoutSecondStep`: for setting up two-step sign-in itself, before the office's requirement is met. */
export async function requireApiStaff(opts: { allowWithoutSecondStep?: boolean } = {}): Promise<User> {
  const user = await requireApiUser();
  if (!isStaffRole(user.role)) throw new AppError("forbidden");
  if (!opts.allowWithoutSecondStep && (await mustSetUpSecondStep(user))) throw new AppError("mfa_setup_required");
  return user;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}
