/**
 * Native push for the iPhone and Android app (mobile/). Browser push doesn't reach an app's web view, so the
 * app registers its device token here and the push outbox (push.ts) sends to it as well:
 *
 *  - Android → Firebase Cloud Messaging, HTTP v1 API, authorised with a service account (FCM_SERVICE_ACCOUNT).
 *  - iPhone  → Apple Push Notification service over HTTP/2, authorised with a .p8 key (APNS_KEY, APNS_KEY_ID,
 *              APNS_TEAM_ID; APNS_TOPIC is the app's bundle id).
 *
 * Both use only Node's crypto and http2 — no SDKs. Tokens the services report as gone are forgotten.
 */
import crypto from "node:crypto";
import http2 from "node:http2";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { nativePushTokens, type NativePushTokenRow, type User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { MAX_DEVICES_PER_USER, type PushPayload } from "./push-shared";

export const NATIVE_PLATFORMS = ["ios", "android"] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

/** APNs device tokens are 64+ hex characters; FCM registration tokens are long URL-safe strings. */
export function isValidNativeToken(platform: NativePlatform, token: string): boolean {
  if (platform === "ios") return /^[0-9a-f]{64,200}$/i.test(token);
  return /^[A-Za-z0-9_:\-.]{20,4096}$/.test(token);
}

export async function saveNativePushToken(db: DbOrTx, user: Pick<User, "id" | "status">, input: { platform: NativePlatform; token: string }) {
  if (user.status === "disabled") throw new AppError("forbidden");
  if (!isValidNativeToken(input.platform, input.token)) throw new AppError("validation", "Invalid device token");
  // The same phone signing in to another account moves the token to that account.
  await db
    .insert(nativePushTokens)
    .values({ userId: user.id, platform: input.platform, token: input.token })
    .onConflictDoUpdate({ target: nativePushTokens.token, set: { userId: user.id, platform: input.platform } });
  const mine = await db.select({ id: nativePushTokens.id, createdAt: nativePushTokens.createdAt }).from(nativePushTokens).where(eq(nativePushTokens.userId, user.id));
  if (mine.length > MAX_DEVICES_PER_USER) {
    const drop = mine.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, mine.length - MAX_DEVICES_PER_USER);
    await db.delete(nativePushTokens).where(inArray(nativePushTokens.id, drop.map((d) => d.id)));
  }
}

export async function removeNativePushToken(db: DbOrTx, user: Pick<User, "id">, token: string) {
  await db.delete(nativePushTokens).where(and(eq(nativePushTokens.userId, user.id), eq(nativePushTokens.token, token)));
}

export async function hasNativePushToken(db: DbOrTx, userId: string, token: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(nativePushTokens).where(and(eq(nativePushTokens.userId, userId), eq(nativePushTokens.token, token)));
  return (r?.n ?? 0) > 0;
}

/** Whether the server can send to that platform. */
export function nativePushConfigured(platform: NativePlatform): boolean {
  if (platform === "android") return !!serviceAccount();
  return !!(env.apnsKey && env.apnsKeyId && env.apnsTeamId && env.apnsTopic);
}

/** A failed send: `gone` means the token is no longer valid and should be forgotten. */
export class NativePushError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly gone: boolean,
  ) {
    super(message);
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// ---------- Android: Firebase Cloud Messaging (HTTP v1) ----------

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = env.fcmServiceAccount.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(json) as Partial<ServiceAccount>;
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

let fcmAccess: { token: string; expires: number; key: string } | null = null;

async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (fcmAccess && fcmAccess.key === sa.client_email && fcmAccess.expires > Date.now() + 60_000) return fcmAccess.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: env.fcmTokenUrl, iat: now, exp: now + 3600 }),
  )}`;
  const assertion = `${unsigned}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key))}`;
  const res = await fetch(env.fcmTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !body.access_token) throw new NativePushError(`FCM sign-in failed (${res.status})`, res.status, false);
  fcmAccess = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000, key: sa.client_email };
  return body.access_token;
}

async function sendFcm(token: string, payload: PushPayload) {
  const sa = serviceAccount();
  if (!sa) throw new NativePushError("FCM is not configured", 0, false);
  const access = await fcmAccessToken(sa);
  const res = await fetch(`${env.fcmApiUrl}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url, tag: payload.tag },
        android: { priority: "high", notification: { tag: payload.tag, icon: "ic_stat_notify", color: "#4338CA", default_sound: true } },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  if (res.status === 401) fcmAccess = null;
  // UNREGISTERED (404) or a malformed/foreign token (400 about the registration token): forget the device.
  const gone = res.status === 404 || /UNREGISTERED/.test(text) || (res.status === 400 && /registration token/i.test(text));
  throw new NativePushError(`FCM responded ${res.status}: ${text.slice(0, 200)}`, res.status, gone);
}

// ---------- iPhone: Apple Push Notification service (HTTP/2, token auth) ----------

let apnsJwt: { token: string; issued: number; key: string } | null = null;

function apnsAuthToken(): string {
  // Apple accepts a token for an hour and rejects refreshing more than every 20 minutes: reuse for 40.
  if (apnsJwt && apnsJwt.key === env.apnsKeyId && Date.now() - apnsJwt.issued < 40 * 60_000) return apnsJwt.token;
  const unsigned = `${b64url(JSON.stringify({ alg: "ES256", kid: env.apnsKeyId }))}.${b64url(JSON.stringify({ iss: env.apnsTeamId, iat: Math.floor(Date.now() / 1000) }))}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: env.apnsKey, dsaEncoding: "ieee-p1363" });
  apnsJwt = { token: `${unsigned}.${b64url(sig)}`, issued: Date.now(), key: env.apnsKeyId };
  return apnsJwt.token;
}

function apnsOrigin() {
  if (env.apnsUrl) return env.apnsUrl;
  return env.apnsEnvironment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
}

async function sendApns(token: string, payload: PushPayload) {
  if (!nativePushConfigured("ios")) throw new NativePushError("APNs is not configured", 0, false);
  const body = JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default", "thread-id": "case-manager" }, url: payload.url, tag: payload.tag });
  const auth = apnsAuthToken();
  const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const client = http2.connect(apnsOrigin());
    const done = (err: Error | null, r?: { status: number; text: string }) => {
      client.close();
      if (err) reject(err);
      else resolve(r!);
    };
    client.on("error", (e) => done(e));
    client.setTimeout(10_000, () => done(new Error("APNs timed out")));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${auth}`,
      "apns-topic": env.apnsTopic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600),
      "apns-collapse-id": payload.tag.slice(0, 64),
      "content-type": "application/json",
    });
    let statusCode = 0;
    let data = "";
    req.setEncoding("utf8");
    req.on("response", (h) => (statusCode = Number(h[":status"])));
    req.on("data", (c: string) => (data += c));
    req.on("end", () => done(null, { status: statusCode, text: data }));
    req.on("error", (e) => done(e));
    req.end(body);
  });
  if (status === 200) return;
  if (status === 403 && /ExpiredProviderToken|InvalidProviderToken/.test(text)) apnsJwt = null;
  // 410 Unregistered, or a token from another app/environment: forget the device.
  const gone = status === 410 || /BadDeviceToken|DeviceTokenNotForTopic|Unregistered/.test(text);
  throw new NativePushError(`APNs responded ${status}: ${text.slice(0, 200)}`, status, gone);
}

/** One notification to one app install. Throws NativePushError on failure. */
export async function deliverNative(row: Pick<NativePushTokenRow, "platform" | "token">, payload: PushPayload) {
  if (row.platform === "ios") return sendApns(row.token, payload);
  return sendFcm(row.token, payload);
}

/** For tests: forget cached access tokens. */
export function resetNativePushCache() {
  fcmAccess = null;
  apnsJwt = null;
}
