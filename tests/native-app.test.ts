import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { countPushDevices, dispatchPendingPushes, queueTestPush, usersWithPush } from "@/lib/services/push";
import { hasNativePushToken, isValidNativeToken, removeNativePushToken, resetNativePushCache, saveNativePushToken } from "@/lib/services/native-push";
import { appChallengeFor, appReturnLink, createAppSignIn, isValidAppChallenge, redeemAppSignIn } from "@/lib/services/app-sign-in";
import { googleAttemptApp, startGoogleSignIn } from "@/lib/services/google";
import { expectCode, makeUser, setupDb } from "./helpers";

let db: Database;

// ---------- Stand-ins for Google (OAuth + FCM) and Apple (APNs, HTTP/2) ----------

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = (k: crypto.KeyObject) => k.export({ type: "pkcs8", format: "pem" }).toString();

type Sent = { platform: "android" | "ios"; token: string; body: Record<string, unknown>; headers: Record<string, unknown> };
let sent: Sent[] = [];
let tokenRequests = 0;
let fcm: http.Server;
let apns: http2.Http2Server;

const jwtParts = (jwt: string) => {
  const [h, p, sig] = jwt.split(".");
  return { header: JSON.parse(Buffer.from(h!, "base64url").toString()), claims: JSON.parse(Buffer.from(p!, "base64url").toString()), data: `${h}.${p}`, sig: Buffer.from(sig!, "base64url") };
};

beforeAll(async () => {
  db = await setupDb();
  fcm = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/token") {
        tokenRequests++;
        const jwt = jwtParts(new URLSearchParams(raw).get("assertion")!);
        const valid = crypto.verify("RSA-SHA256", Buffer.from(jwt.data), rsa.publicKey, jwt.sig);
        expect(jwt.claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
        res.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }));
      }
      expect(req.url).toBe("/v1/projects/case-app/messages:send");
      expect(req.headers.authorization).toBe("Bearer ya29.test");
      const body = JSON.parse(raw) as { message: { token: string } };
      sent.push({ platform: "android", token: body.message.token, body, headers: req.headers });
      if (body.message.token.startsWith("gone")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "projects/case-app/messages/1" }));
    });
  });
  await new Promise<void>((r) => fcm.listen(0, "127.0.0.1", r));
  apns = http2.createServer();
  apns.on("stream", (stream, headers) => {
    let raw = "";
    stream.on("data", (c) => (raw += c));
    stream.on("end", () => {
      const token = String(headers[":path"]).replace("/3/device/", "");
      const jwt = jwtParts(String(headers.authorization).replace(/^bearer /, ""));
      const valid = crypto.verify("sha256", Buffer.from(jwt.data), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, jwt.sig);
      sent.push({ platform: "ios", token, body: JSON.parse(raw), headers: { ...headers, jwt } });
      if (!valid) {
        stream.respond({ ":status": 403 });
        return stream.end(JSON.stringify({ reason: "InvalidProviderToken" }));
      }
      if (token.startsWith("dead")) {
        stream.respond({ ":status": 410 });
        return stream.end(JSON.stringify({ reason: "Unregistered" }));
      }
      stream.respond({ ":status": 200 });
      stream.end();
    });
  });
  await new Promise<void>((r) => apns.listen(0, "127.0.0.1", r));
  const fcmBase = `http://127.0.0.1:${(fcm.address() as { port: number }).port}`;
  Object.assign(env, {
    fcmServiceAccount: Buffer.from(JSON.stringify({ project_id: "case-app", client_email: "push@case-app.iam.gserviceaccount.com", private_key: pem(rsa.privateKey) })).toString("base64"),
    fcmApiUrl: fcmBase,
    fcmTokenUrl: `${fcmBase}/token`,
    apnsKey: pem(ec.privateKey),
    apnsKeyId: "KEY1234567",
    apnsTeamId: "TEAM123456",
    apnsTopic: "app.casemanager.mobile",
    apnsUrl: `http://127.0.0.1:${(apns.address() as { port: number }).port}`,
  });
});
afterAll(() => {
  fcm.close();
  apns.close();
});
beforeEach(() => {
  sent = [];
  resetNativePushCache();
});

const iosToken = (prefix = "") => (prefix + crypto.randomBytes(32).toString("hex")).slice(0, 64).padEnd(64, "a");
const androidToken = (prefix = "") => `${prefix}${crypto.randomBytes(40).toString("base64url")}:APA91b${crypto.randomBytes(30).toString("base64url")}`;
const pushRows = (userId: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.channel, "push")));

describe("app devices", () => {
  it("validates tokens per platform", () => {
    expect(isValidNativeToken("ios", iosToken())).toBe(true);
    expect(isValidNativeToken("ios", "not-hex")).toBe(false);
    expect(isValidNativeToken("android", androidToken())).toBe(true);
    expect(isValidNativeToken("android", "short")).toBe(false);
    expect(isValidNativeToken("android", "bad token with spaces and more than twenty")).toBe(false);
  });

  it("registers a phone, counts it with browsers, moves it to whoever signs in, and removes it", async () => {
    const a = await makeUser(db, "customer");
    const b = await makeUser(db, "customer");
    const t = iosToken();
    await saveNativePushToken(db, a, { platform: "ios", token: t });
    await saveNativePushToken(db, a, { platform: "ios", token: t });
    expect(await countPushDevices(db, a.id)).toBe(1);
    expect(await usersWithPush(db, [a.id, b.id])).toEqual(new Set([a.id]));
    expect(await hasNativePushToken(db, a.id, t)).toBe(true);
    await saveNativePushToken(db, b, { platform: "ios", token: t });
    expect(await countPushDevices(db, a.id)).toBe(0);
    expect(await countPushDevices(db, b.id)).toBe(1);
    await removeNativePushToken(db, a, t); // not a's any more: no effect
    expect(await countPushDevices(db, b.id)).toBe(1);
    await removeNativePushToken(db, b, t);
    expect(await countPushDevices(db, b.id)).toBe(0);
  });

  it("refuses invalid tokens and disabled accounts", async () => {
    const u = await makeUser(db, "customer");
    await expectCode(saveNativePushToken(db, u, { platform: "ios", token: "zz" }), "validation");
    const off = await makeUser(db, "customer", { status: "disabled" });
    await expectCode(saveNativePushToken(db, off, { platform: "android", token: androidToken() }), "forbidden");
  });
});

describe("sending to the app", () => {
  it("sends to iPhone through APNs and to Android through FCM, signed with the configured keys", async () => {
    const u = await makeUser(db, "customer");
    const ios = iosToken();
    const android = androidToken();
    await saveNativePushToken(db, u, { platform: "ios", token: ios });
    await saveNativePushToken(db, u, { platform: "android", token: android });
    await queueTestPush(db, u, { title: "Hello", body: "World" });
    expect(await dispatchPendingPushes(db)).toBe(1);

    const toIos = sent.find((x) => x.platform === "ios")!;
    expect(toIos.token).toBe(ios);
    expect(toIos.body).toMatchObject({ aps: { alert: { title: "Hello", body: "World" }, sound: "default" }, url: `${env.appUrl}/` });
    expect(toIos.headers["apns-topic"]).toBe("app.casemanager.mobile");
    expect(toIos.headers["apns-push-type"]).toBe("alert");
    const jwt = toIos.headers.jwt as { header: { alg: string; kid: string }; claims: { iss: string } };
    expect(jwt.header).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(jwt.claims.iss).toBe("TEAM123456");

    const toAndroid = sent.find((x) => x.platform === "android")!;
    expect(toAndroid.body).toMatchObject({ message: { token: android, notification: { title: "Hello", body: "World" }, data: { url: `${env.appUrl}/` }, android: { priority: "high" } } });

    const [row] = await pushRows(u.id);
    expect(row!.status).toBe("sent");
    const devices = await db.select().from(s.nativePushTokens).where(eq(s.nativePushTokens.userId, u.id));
    expect(devices.every((d) => d.lastSuccessAt)).toBe(true);
  });

  it("reuses Google's access token between sends", async () => {
    const u = await makeUser(db, "customer");
    await saveNativePushToken(db, u, { platform: "android", token: androidToken() });
    const before = tokenRequests;
    await queueTestPush(db, u, { title: "1", body: "" });
    await dispatchPendingPushes(db);
    await queueTestPush(db, u, { title: "2", body: "" });
    await dispatchPendingPushes(db);
    expect(tokenRequests - before).toBe(1);
  });

  it("forgets phones the services report as gone", async () => {
    const u = await makeUser(db, "customer");
    await saveNativePushToken(db, u, { platform: "ios", token: iosToken("dead") });
    await saveNativePushToken(db, u, { platform: "android", token: androidToken("gone") });
    await queueTestPush(db, u, { title: "x", body: "y" });
    await dispatchPendingPushes(db);
    expect(await countPushDevices(db, u.id)).toBe(0);
    const [row] = await pushRows(u.id);
    expect(row!.status).toBe("failed");
    expect(row!.error).toBe("devices_gone");
  });

  it("without credentials for a platform, its phones are skipped and the reason recorded", async () => {
    const saved = { apnsKey: env.apnsKey };
    Object.assign(env, { apnsKey: "" });
    try {
      const u = await makeUser(db, "customer");
      await saveNativePushToken(db, u, { platform: "ios", token: iosToken() });
      await queueTestPush(db, u, { title: "x", body: "y" });
      await dispatchPendingPushes(db);
      expect(sent).toHaveLength(0);
      const [row] = await pushRows(u.id);
      expect(row!.error).toBe("app_push_not_configured");
      expect(await countPushDevices(db, u.id)).toBe(1);
    } finally {
      Object.assign(env, saved);
    }
  });
});

describe("Google sign-in from the app", () => {
  const verifier = () => crypto.randomBytes(32).toString("base64url");

  it("a one-time code, redeemable once and only with the app's secret", async () => {
    const u = await makeUser(db, "customer");
    const v = verifier();
    const challenge = appChallengeFor(v);
    expect(isValidAppChallenge(challenge)).toBe(true);
    const code = await createAppSignIn(db, challenge, { userId: u.id, mfaPending: false }, "/portal/cases");
    expect(appReturnLink({ code })).toBe(`app.casemanager.mobile://auth?code=${code}`);
    const grant = await redeemAppSignIn(db, code, v);
    expect(grant).toMatchObject({ userId: u.id, mfaPending: false, signupToken: null, next: "/portal/cases" });
    await expectCode(redeemAppSignIn(db, code, v), "forbidden");
  });

  it("a wrong secret fails and uses the code up", async () => {
    const u = await makeUser(db, "customer");
    const v = verifier();
    const code = await createAppSignIn(db, appChallengeFor(v), { userId: u.id, mfaPending: false }, null);
    await expectCode(redeemAppSignIn(db, code, verifier()), "forbidden");
    await expectCode(redeemAppSignIn(db, code, v), "forbidden");
  });

  it("expires after five minutes, and never redirects off-site", async () => {
    const u = await makeUser(db, "customer");
    const v = verifier();
    const code = await createAppSignIn(db, appChallengeFor(v), { userId: u.id, mfaPending: true }, "//evil.example");
    const mine = (await db.select().from(s.appSignIns)).find((r) => r.userId === u.id)!;
    expect(mine.next).toBeNull();
    expect(mine.mfaPending).toBe(true);
    expect(mine.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    await db.update(s.appSignIns).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.appSignIns.id, mine.id));
    await expectCode(redeemAppSignIn(db, code, v), "forbidden");
  });

  it("carries a new account's sign-up to the app", async () => {
    const v = verifier();
    const code = await createAppSignIn(db, appChallengeFor(v), { signupToken: "signed-pending" }, null);
    expect(await redeemAppSignIn(db, code, v)).toMatchObject({ userId: null, signupToken: "signed-pending" });
  });

  it("the Google attempt remembers it came from the app (not for calendar connections)", () => {
    const saved = { googleClientId: env.googleClientId, googleClientSecret: env.googleClientSecret };
    Object.assign(env, { googleClientId: "id.apps.googleusercontent.com", googleClientSecret: "secret" });
    try {
      const challenge = appChallengeFor(verifier());
      expect(googleAttemptApp(startGoogleSignIn("/portal", { app: challenge }).cookie)).toBe(challenge);
      expect(googleAttemptApp(startGoogleSignIn("/portal").cookie)).toBeNull();
      expect(googleAttemptApp(startGoogleSignIn("/admin", { app: challenge, calendarFor: "u1" }).cookie)).toBeNull();
      expect(googleAttemptApp("forged")).toBeNull();
    } finally {
      Object.assign(env, saved);
    }
  });

  it("rejects malformed challenges", () => {
    expect(isValidAppChallenge("short")).toBe(false);
    expect(isValidAppChallenge(null)).toBe(false);
    expect(isValidAppChallenge("a".repeat(43))).toBe(true);
  });
});
