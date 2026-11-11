/**
 * Web Push notifications (browsers and phones, including iPhone home-screen apps), plus the iPhone/Android
 * app's native push (native-push.ts) — one outbox for both.
 *
 * Every in-app notification for a user who has enabled push on at least one device also gets a "push" row in
 * the notifications outbox; `dispatchPendingPushes` sends it to all of that user's devices, retries transient
 * failures and forgets devices the push service reports as gone (404/410).
 *
 * VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if set; otherwise a key pair is generated once and stored
 * encrypted in the settings table, so push works without any setup.
 */
import { after } from "next/server";
import webpush from "web-push";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, type Database, type DbOrTx } from "../db";
import { nativePushTokens, notifications, pushSubscriptions, settings, type User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { decryptBuffer, encryptBuffer } from "../crypto";
import { MAX_DEVICES_PER_USER, type PushPayload } from "./push-shared";
import { NativePushError, deliverNative, nativePushConfigured } from "./native-push";

export { MAX_DEVICES_PER_USER, type PushPayload };

const VAPID_KEY = "push.vapid";

export type VapidKeys = { publicKey: string; privateKey: string };

export async function getVapidKeys(db: DbOrTx): Promise<VapidKeys> {
  if (env.vapidPublicKey && env.vapidPrivateKey) return { publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey };
  const read = async () => {
    const [row] = await db.select().from(settings).where(eq(settings.key, VAPID_KEY));
    const enc = (row?.value as { enc?: string } | undefined)?.enc;
    return enc ? (JSON.parse(decryptBuffer(Buffer.from(enc, "base64")).toString("utf8")) as VapidKeys) : null;
  };
  const existing = await read();
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  const enc = encryptBuffer(Buffer.from(JSON.stringify(keys), "utf8")).toString("base64");
  // Two servers starting at once: the first insert wins and both use it.
  await db.insert(settings).values({ key: VAPID_KEY, value: { enc } }).onConflictDoNothing();
  return (await read())!;
}

/** Contact for push services (required by VAPID): VAPID_SUBJECT, else the app's https URL, else the admin email. */
export function vapidSubject(): string {
  if (env.vapidSubject) return env.vapidSubject;
  if (env.appUrl.startsWith("https://")) return env.appUrl;
  return `mailto:${env.adminEmail}`;
}

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/**
 * Browser push services (Chrome/Edge/Opera/Samsung → FCM, Firefox → Mozilla, Safari → Apple, legacy Edge → WNS).
 * Endpoints elsewhere are refused, so the server can't be made to send requests to arbitrary or internal hosts.
 */
export const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (env.pushExtraHosts.includes(u.host)) return u.protocol === "https:" || u.protocol === "http:";
  if (!env.isProd && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return u.protocol === "https:" || u.protocol === "http:";
  return u.protocol === "https:" && PUSH_SERVICE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

/** Stores (or moves to this user) the browser's subscription. Idempotent per endpoint. */
export async function savePushSubscription(db: DbOrTx, user: Pick<User, "id" | "status">, sub: PushSubscriptionInput, userAgent?: string | null) {
  if (user.status === "disabled") throw new AppError("forbidden");
  if (!isAllowedPushEndpoint(sub.endpoint)) throw new AppError("validation", "Invalid push endpoint");
  const values = { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null };
  // The same browser signing in to another account moves the subscription to that account.
  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: values.p256dh, auth: values.auth, userAgent: values.userAgent } });
  const mine = await db.select({ id: pushSubscriptions.id, createdAt: pushSubscriptions.createdAt }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
  if (mine.length > MAX_DEVICES_PER_USER) {
    const drop = mine.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, mine.length - MAX_DEVICES_PER_USER);
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, drop.map((d) => d.id)));
  }
}

/** Turns push off for one device. Only the owner can remove it. */
export async function removePushSubscription(db: DbOrTx, user: Pick<User, "id">, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Browsers plus app installs with push turned on. */
export async function countPushDevices(db: DbOrTx, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(nativePushTokens).where(eq(nativePushTokens.userId, userId));
  return (r?.n ?? 0) + (a?.n ?? 0);
}

/** Users (of `ids`) who have push enabled on at least one device (a browser or the app). */
export async function usersWithPush(db: DbOrTx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions).where(inArray(pushSubscriptions.userId, ids));
  const apps = await db.selectDistinct({ userId: nativePushTokens.userId }).from(nativePushTokens).where(inArray(nativePushTokens.userId, ids));
  return new Set([...rows, ...apps].map((r) => r.userId));
}

const absolute = (link: string | null) => (link ? new URL(link, env.appUrl).toString() : `${env.appUrl}/`);

/**
 * One encrypted message to one device. web-push builds the request (aes128gcm encryption + VAPID signature);
 * it's sent with fetch, which works through proxies and with any endpoint savePushSubscription accepted.
 */
async function deliver(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload, vapidDetails: { subject: string; publicKey: string; privateKey: string }) {
  const req = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
    vapidDetails,
    TTL: 24 * 3600,
    urgency: "normal",
  });
  const res = await fetch(req.endpoint, {
    method: "POST",
    headers: req.headers as Record<string, string>,
    body: req.body ? new Uint8Array(req.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status >= 200 && res.status < 300) return;
  const err = new Error(`Push service responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`) as Error & { statusCode: number };
  err.statusCode = res.status;
  throw err;
}

/** Sends queued push notifications. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchPendingPushes(db: Database, limit = 50): Promise<number> {
  const claimed = await db.execute(sql`
    update notifications set attempts = attempts + 1
    where id in (
      select id from notifications
      where channel = 'push' and status = 'pending' and attempts < 5
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, user_id, title, body, link, attempts`);
  const list = (claimed as unknown as { rows: Record<string, unknown>[] }).rows ?? (claimed as unknown as Record<string, unknown>[]);
  if (list.length === 0) return 0;
  let vapidDetails: { subject: string; publicKey: string; privateKey: string } | null = null;
  let delivered = 0;

  for (const n of list) {
    const id = String(n.id);
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, String(n.user_id)));
    const apps = await db.select().from(nativePushTokens).where(eq(nativePushTokens.userId, String(n.user_id)));
    if (subs.length === 0 && apps.length === 0) {
      await db.update(notifications).set({ status: "failed", error: "no_devices" }).where(eq(notifications.id, id));
      continue;
    }
    const payload: PushPayload = { title: String(n.title), body: String(n.body ?? ""), url: absolute((n.link as string) ?? null), tag: id };
    let ok = 0;
    let transient: string | null = null;
    let unconfigured = false;
    for (const a of apps) {
      // The app on a platform the server has no push credentials for (see .env.example): nothing to send with.
      if (!nativePushConfigured(a.platform)) {
        unconfigured = true;
        continue;
      }
      try {
        await deliverNative(a, payload);
        ok++;
        await db.update(nativePushTokens).set({ lastSuccessAt: new Date() }).where(eq(nativePushTokens.id, a.id));
      } catch (err) {
        if (err instanceof NativePushError && err.gone) await db.delete(nativePushTokens).where(eq(nativePushTokens.id, a.id));
        else transient = `${(err as Error).message ?? String(err)}`.trim().slice(0, 300);
      }
    }
    if (subs.length > 0 && !vapidDetails) {
      const keys = await getVapidKeys(db);
      vapidDetails = { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey };
    }
    for (const s of subs) {
      try {
        await deliver(s, payload, vapidDetails!);
        ok++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed or the subscription expired — forget this device.
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else transient = `${status ?? ""} ${(err as Error).message ?? String(err)}`.trim().slice(0, 300);
      }
    }
    if (ok > 0) {
      await db.update(notifications).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(notifications.id, id));
      delivered++;
    } else if (transient) {
      const attempts = Number(n.attempts ?? 1);
      await db.update(notifications).set({ status: attempts >= 5 ? "failed" : "pending", error: transient }).where(eq(notifications.id, id));
    } else {
      await db.update(notifications).set({ status: "failed", error: unconfigured ? "app_push_not_configured" : "devices_gone" }).where(eq(notifications.id, id));
    }
  }
  return delivered;
}

/** Sends right after the response (or now, outside a request). Skipped in unit tests. */
export function schedulePushDispatch() {
  if (env.isTest) return;
  const run = async () => {
    try {
      await dispatchPendingPushes(await getDb());
    } catch (err) {
      console.error("[push] dispatch failed", err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** A test notification to all of the user's devices ("Send a test" in the settings). */
export async function queueTestPush(db: DbOrTx, user: Pick<User, "id">, text: { title: string; body: string }) {
  if ((await countPushDevices(db, user.id)) === 0) throw new AppError("validation", "Push is not enabled on any device");
  await db.insert(notifications).values({ userId: user.id, type: "push_test", channel: "push", title: text.title, body: text.body, link: null, status: "pending" });
}

/** Old delivered/failed push and WhatsApp rows aren't shown anywhere; keep the outbox small. */
export async function prunePushOutbox(db: DbOrTx, olderThanDays = 30) {
  await db
    .delete(notifications)
    .where(and(inArray(notifications.channel, ["push", "whatsapp"]), inArray(notifications.status, ["sent", "failed"]), lt(notifications.createdAt, new Date(Date.now() - olderThanDays * 86400_000))));
}
