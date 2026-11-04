import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require("http_ece") as { decrypt: (buf: Buffer, opts: Record<string, unknown>) => Buffer };
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { notify } from "@/lib/services/notifications";
import {
  MAX_DEVICES_PER_USER,
  countPushDevices,
  dispatchPendingPushes,
  getVapidKeys,
  isAllowedPushEndpoint,
  prunePushOutbox,
  queueTestPush,
  removePushSubscription,
  savePushSubscription,
  vapidSubject,
} from "@/lib/services/push";
import { runJobs } from "@/lib/services/jobs";
import { expectCode, makeUser, setupDb } from "./helpers";

let db: Database;

/** A local stand-in for a browser push service (FCM, Mozilla, Apple). Real web-push encryption reaches it. */
type Received = { path: string; headers: http.IncomingHttpHeaders; body: Buffer };
let received: Received[] = [];
let respond: (path: string) => number = () => 201;
let server: http.Server;
let base = "";

/** A "browser": its key pair, so the test can decrypt what the server sent, like the real browser would. */
function device(path = crypto.randomUUID()) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: { endpoint: `${base}/push/${path}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    path,
    decrypt(body: Buffer) {
      return JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: ecdh, authSecret: auth.toString("base64url") }).toString("utf8"));
    },
  };
}
const toDevice = (d: ReturnType<typeof device>) => received.filter((r) => r.path === `/push/${d.path}`);
const pushRows = (userId: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.channel, "push")));

beforeAll(async () => {
  db = await setupDb();
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(respond(req.url!));
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  received = [];
  respond = () => 201;
});

describe("VAPID keys", () => {
  it("are generated once, stored encrypted, and reused", async () => {
    const a = await getVapidKeys(db);
    const b = await getVapidKeys(db);
    expect(a).toEqual(b);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,90}$/);
    const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "push.vapid"));
    expect(JSON.stringify(row!.value)).not.toContain(a.privateKey);
  });

  it("environment variables take precedence", async () => {
    const saved = { vapidPublicKey: env.vapidPublicKey, vapidPrivateKey: env.vapidPrivateKey };
    Object.assign(env, { vapidPublicKey: "PUB", vapidPrivateKey: "PRIV" });
    try {
      expect(await getVapidKeys(db)).toEqual({ publicKey: "PUB", privateKey: "PRIV" });
    } finally {
      Object.assign(env, saved);
    }
  });

  it("the contact defaults to the site URL or the admin email", () => {
    const saved = { vapidSubject: env.vapidSubject, appUrl: env.appUrl };
    try {
      Object.assign(env, { vapidSubject: "", appUrl: "https://case.example.com" });
      expect(vapidSubject()).toBe("https://case.example.com");
      Object.assign(env, { appUrl: "http://localhost:3000" });
      expect(vapidSubject()).toBe(`mailto:${env.adminEmail}`);
      Object.assign(env, { vapidSubject: "mailto:ops@example.com" });
      expect(vapidSubject()).toBe("mailto:ops@example.com");
    } finally {
      Object.assign(env, saved);
    }
  });
});

describe("devices", () => {
  it("subscribing is per device, idempotent, and moves a device to whoever signs in on it", async () => {
    const a = await makeUser(db, "customer");
    const b = await makeUser(db, "customer");
    const d = device();
    await savePushSubscription(db, a, d.sub, "Mozilla/5.0 test");
    await savePushSubscription(db, a, d.sub);
    expect(await countPushDevices(db, a.id)).toBe(1);
    await savePushSubscription(db, b, d.sub);
    expect(await countPushDevices(db, a.id)).toBe(0);
    expect(await countPushDevices(db, b.id)).toBe(1);
  });

  it("only the owner can turn a device off", async () => {
    const a = await makeUser(db, "customer");
    const b = await makeUser(db, "customer");
    const d = device();
    await savePushSubscription(db, a, d.sub);
    await removePushSubscription(db, b, d.sub.endpoint);
    expect(await countPushDevices(db, a.id)).toBe(1);
    await removePushSubscription(db, a, d.sub.endpoint);
    expect(await countPushDevices(db, a.id)).toBe(0);
  });

  it(`keeps at most ${MAX_DEVICES_PER_USER} devices per person (the oldest go)`, async () => {
    const u = await makeUser(db, "staff");
    const first = device();
    await savePushSubscription(db, u, first.sub);
    for (let i = 0; i < MAX_DEVICES_PER_USER; i++) await savePushSubscription(db, u, device().sub);
    expect(await countPushDevices(db, u.id)).toBe(MAX_DEVICES_PER_USER);
    const left = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, first.sub.endpoint));
    expect(left).toHaveLength(0);
  });

  it("only accepts real browser push services (no requests to arbitrary or internal hosts)", async () => {
    const u = await makeUser(db, "customer");
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QOabc",
      "https://db5p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      "not a url",
      "javascript:alert(1)",
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://169.254.169.254/latest/meta-data",
      "https://internal.service.local/hook",
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
      await expectCode(savePushSubscription(db, u, { ...device().sub, endpoint: bad }), "validation");
    }
    const saved = { isProd: env.isProd, pushExtraHosts: env.pushExtraHosts };
    try {
      Object.assign(env, { isProd: true });
      expect(isAllowedPushEndpoint(device().sub.endpoint)).toBe(false); // localhost only outside production…
      Object.assign(env, { pushExtraHosts: [new URL(base).host] });
      expect(isAllowedPushEndpoint(device().sub.endpoint)).toBe(true); // …or when listed in PUSH_EXTRA_HOSTS
    } finally {
      Object.assign(env, saved);
    }
    await expectCode(savePushSubscription(db, await makeUser(db, "customer", { status: "disabled" }), device().sub), "forbidden");
  });
});

describe("sending", () => {
  it("every notification also goes to all of the person's devices, encrypted, in their language", async () => {
    const u = await makeUser(db, "customer", { locale: "en" });
    const phone = device();
    const laptop = device();
    await savePushSubscription(db, u, phone.sub);
    await savePushSubscription(db, u, laptop.sub);
    await notify(db, { userIds: [u.id], type: "quote_ready", caseId: null, vars: { number: "CASE-2026-0042" }, link: "/portal/cases/abc?tab=quote" });
    expect((await pushRows(u.id)).map((r) => r.status)).toEqual(["pending"]);

    expect(await dispatchPendingPushes(db)).toBe(1);
    for (const d of [phone, laptop]) {
      const [msg] = toDevice(d);
      expect(msg, d.path).toBeTruthy();
      expect(msg!.headers["content-encoding"]).toBe("aes128gcm");
      expect(msg!.headers.ttl).toBe(String(24 * 3600));
      expect(msg!.headers.authorization).toMatch(/^vapid t=.+, k=/);
      expect(msg!.body.includes(Buffer.from("CASE-2026-0042"))).toBe(false); // really encrypted
      const payload = d.decrypt(msg!.body);
      expect(payload).toMatchObject({ title: "Your quote is ready", body: "A quote for case CASE-2026-0042 is waiting for your review.", url: `${env.appUrl}/portal/cases/abc?tab=quote` });
      expect(payload.tag).toBe((await pushRows(u.id))[0]!.id);
    }
    const [row] = await pushRows(u.id);
    expect(row).toMatchObject({ status: "sent", error: null });
    const subs = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, u.id));
    expect(subs.every((x) => x.lastSuccessAt)).toBe(true);
  });

  it("people without push get no push rows (only in-app and email)", async () => {
    const u = await makeUser(db, "customer");
    await notify(db, { userIds: [u.id], type: "new_message", vars: { number: "CASE-1", preview: "hi" }, link: "/portal" });
    expect(await pushRows(u.id)).toHaveLength(0);
    const channels = (await db.select().from(s.notifications).where(eq(s.notifications.userId, u.id))).map((r) => r.channel).sort();
    expect(channels).toEqual(["email", "in_app"]);
  });

  it("forgets devices the push service says are gone (404/410), keeps the others", async () => {
    const u = await makeUser(db, "customer");
    const gone = device();
    const alive = device();
    await savePushSubscription(db, u, gone.sub);
    await savePushSubscription(db, u, alive.sub);
    respond = (path) => (path.endsWith(gone.path) ? 410 : 201);
    await notify(db, { userIds: [u.id], type: "case_completed", vars: { number: "C-1" } });
    await dispatchPendingPushes(db);
    expect(await countPushDevices(db, u.id)).toBe(1);
    expect((await pushRows(u.id))[0]!.status).toBe("sent");
    // All devices gone: the row is marked failed, nothing left to retry.
    respond = () => 404;
    await notify(db, { userIds: [u.id], type: "case_completed", vars: { number: "C-2" } });
    await dispatchPendingPushes(db);
    expect(await countPushDevices(db, u.id)).toBe(0);
    expect((await pushRows(u.id)).find((r) => r.body.includes("C-2") || r.title.includes("C-2"))!).toMatchObject({ status: "failed", error: "devices_gone" });
  });

  it("retries when the push service is down, up to 5 attempts", async () => {
    const u = await makeUser(db, "customer");
    await savePushSubscription(db, u, device().sub);
    respond = () => 503;
    await notify(db, { userIds: [u.id], type: "case_completed", vars: { number: "C-3" } });
    for (let i = 1; i <= 4; i++) {
      await dispatchPendingPushes(db);
      expect((await pushRows(u.id))[0]).toMatchObject({ status: "pending", attempts: i });
    }
    await dispatchPendingPushes(db);
    expect((await pushRows(u.id))[0]).toMatchObject({ status: "failed", attempts: 5 });
    expect((await pushRows(u.id))[0]!.error).toMatch(/503/);
    // The device itself is kept: the outage wasn't its fault.
    expect(await countPushDevices(db, u.id)).toBe(1);
    // Recovers once the service is back, for new notifications.
    respond = () => 201;
    await notify(db, { userIds: [u.id], type: "case_completed", vars: { number: "C-4" } });
    expect(await dispatchPendingPushes(db)).toBe(1);
  });

  it("disabled accounts get nothing", async () => {
    const u = await makeUser(db, "staff");
    await savePushSubscription(db, u, device().sub);
    await db.update(s.users).set({ status: "disabled" }).where(eq(s.users.id, u.id));
    await notify(db, { userIds: [u.id], type: "task_assigned", vars: { title: "x", number: "C" } });
    expect(await pushRows(u.id)).toHaveLength(0);
  });

  it("the test notification reaches every device, and needs at least one", async () => {
    const u = await makeUser(db, "customer");
    await expectCode(queueTestPush(db, u, { title: "T", body: "B" }), "validation");
    const d = device();
    await savePushSubscription(db, u, d.sub);
    await queueTestPush(db, u, { title: "Notifications work", body: "Test" });
    await dispatchPendingPushes(db);
    expect(d.decrypt(toDevice(d)[0]!.body)).toMatchObject({ title: "Notifications work", body: "Test", url: `${env.appUrl}/` });
  });

  it("the scheduled jobs retry pending pushes and prune old ones", async () => {
    const u = await makeUser(db, "customer");
    await savePushSubscription(db, u, device().sub);
    await notify(db, { userIds: [u.id], type: "case_completed", vars: { number: "C-5" } });
    const r = await runJobs(db);
    expect(r.pushesSent).toBeGreaterThanOrEqual(1);
    await db.update(s.notifications).set({ createdAt: new Date(Date.now() - 40 * 86400_000) }).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "push")));
    await prunePushOutbox(db);
    expect(await pushRows(u.id)).toHaveLength(0);
    // In-app notifications are never pruned.
    expect((await db.select().from(s.notifications).where(and(eq(s.notifications.userId, u.id), eq(s.notifications.channel, "in_app")))).length).toBe(1);
  });

  it("deleting an account removes its devices", async () => {
    const u = await makeUser(db, "customer");
    await savePushSubscription(db, u, device().sub);
    await db.delete(s.customers).where(eq(s.customers.userId, u.id));
    await db.delete(s.users).where(eq(s.users.id, u.id));
    expect(await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, u.id))).toHaveLength(0);
  });
});
