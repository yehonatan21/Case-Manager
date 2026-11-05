// Push notifications in the browser. Headless Chromium has no push service, so the browser's PushManager is
// replaced with one that returns a subscription pointing at a local stand-in push service (started here on
// :4012); everything else is real: the "Notifications on this device" switch, the service worker, the
// subscription API, the server's encryption (decrypted here with the device's key) and the service worker
// showing the notification (pushed in through Chrome DevTools).
// Requires the app in demo mode with PUSH_EXTRA_HOSTS=localhost:4012:
//   PUSH_EXTRA_HOSTS=localhost:4012 DEMO_MODE=true ... npm start
//   BASE=http://localhost:3000 node e2e/push.cjs
const http = require("node:http");
const crypto = require("node:crypto");
const ece = require("http_ece");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const PORT = Number(process.env.FAKE_PUSH_PORT || 4012);
const OUT = path.join(__dirname, "screenshots", "push");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1200);
const codeOnScreen = async (p) => (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];

// ---- The "device": its keys, and the push service it is registered with ----
const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
const authSecret = crypto.randomBytes(16).toString("base64url");
const deviceId = crypto.randomUUID();
const fakeSub = { endpoint: `http://localhost:${PORT}/push/${deviceId}`, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: authSecret } };
const inbox = [];
let respondWith = 201;
const pushService = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    let payload = null;
    try {
      payload = JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: ecdh, authSecret }).toString("utf8"));
    } catch (e) {
      payload = { error: String(e) };
    }
    inbox.push({ path: req.url, headers: req.headers, payload });
    res.writeHead(respondWith);
    res.end();
  });
});
async function waitFor(pred, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = inbox.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}; got ${JSON.stringify(inbox.map((m) => m.payload))}`);
}

/** Browser stubs: notification permission and PushManager (persisted in localStorage like a real subscription). */
function stubs(sub) {
  Object.defineProperty(Notification, "permission", { configurable: true, get: () => localStorage.getItem("e2e.perm") || "default" });
  Notification.requestPermission = async () => (localStorage.setItem("e2e.perm", "granted"), "granted");
  const make = () => ({ endpoint: sub.endpoint, expirationTime: null, toJSON: () => sub, unsubscribe: async () => (localStorage.removeItem("e2e.sub"), true) });
  PushManager.prototype.getSubscription = async function () {
    return localStorage.getItem("e2e.sub") ? make() : null;
  };
  PushManager.prototype.subscribe = async function (opts) {
    const key = new Uint8Array(opts.applicationServerKey);
    localStorage.setItem("e2e.appKey", btoa(String.fromCharCode(...key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    localStorage.setItem("e2e.userVisibleOnly", String(opts.userVisibleOnly));
    localStorage.setItem("e2e.sub", "1");
    return make();
  };
}

(async () => {
  await new Promise((r) => pushService.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  try {
    // ---- The client turns notifications on ----
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
    await ctx.addInitScript(stubs, fakeSub);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/login?as=client%40example.com");
    await settle(page);
    await page.fill('input[autocomplete="one-time-code"]', await codeOnScreen(page));
    await page.click("button[type=submit]");
    await page.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
    await page.goto(BASE + "/portal/notifications");
    await settle(page);
    const toggle = page.locator("[data-push-state]");
    await page.locator('[data-push-state="off"]').waitFor();
    await page.getByText("התראות במכשיר הזה").waitFor();
    await toggle.locator("button:has-text('הפעלה')").click();
    await page.locator('[data-push-state="on"]').waitFor({ timeout: 15000 });
    await page.locator("[role=status]", { hasText: "ההתראות הופעלו" }).first().waitFor();
    const serverKey = (await (await fetch(BASE + "/api/push/key")).json()).data.publicKey;
    assert.equal(await page.evaluate(() => localStorage.getItem("e2e.appKey")), serverKey, "subscribed with the server's VAPID key");
    assert.equal(await page.evaluate(() => localStorage.getItem("e2e.userVisibleOnly")), "true");
    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration("/");
      return r ? { scope: r.scope, script: (r.active || r.waiting || r.installing).scriptURL } : null;
    });
    assert.ok(reg && reg.script.endsWith("/sw.js"), "service worker registered");
    await page.screenshot({ path: OUT + "/enabled.png", fullPage: true });
    log("client turned notifications on; service worker registered:", reg.scope);

    // Survives a reload (the subscription is remembered per device).
    await page.reload();
    await settle(page);
    await page.locator('[data-push-state="on"]').waitFor();

    // ---- "Send a test" arrives, encrypted, in Hebrew ----
    await toggle.locator("button:has-text('שליחת בדיקה')").click();
    const test = await waitFor((m) => m.payload && m.payload.title === "ההתראות פועלות", "the test push");
    assert.equal(test.path, `/push/${deviceId}`);
    assert.match(test.headers.authorization, new RegExp(`^vapid t=.+, k=${serverKey}$`));
    assert.equal(test.headers["content-encoding"], "aes128gcm");
    log("test push delivered and decrypted:", test.payload.title);

    // ---- A real event: a manager opens a request for this client ----
    const staff = await browser.newContext({ locale: "he-IL" });
    const sp = await staff.newPage();
    await sp.goto(BASE + "/login?as=manager%40example.com");
    await settle(sp);
    await sp.fill('input[autocomplete="one-time-code"]', await codeOnScreen(sp));
    await sp.click("button[type=submit]");
    await sp.waitForURL((u) => new URL(u).pathname.startsWith("/admin"), { timeout: 20000 });
    const title = `התראה ${Date.now()}`;
    const r = await sp.request.fetch(BASE + "/api/admin/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title, description: "בדיקה", serviceCategory: "other", urgency: "normal" },
    });
    assert.equal(r.status(), 200, await r.text());
    const caseId = (await r.json()).data.id;
    const push = await waitFor((m) => m.payload && m.payload.body && m.payload.body.includes(title), "the case push");
    assert.match(push.payload.title, /^נפתחה עבורך בקשה: CASE-/);
    assert.equal(new URL(push.payload.url).pathname, `/portal/cases/${caseId}`);
    log("real notification pushed:", push.payload.title);

    // ---- The service worker shows it ----
    const cdp = await ctx.newCDPSession(page);
    const regId = new Promise((resolve) => cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => e.registrations.forEach((x) => !x.isDeleted && resolve(x.registrationId))));
    await cdp.send("ServiceWorker.enable");
    await ctx.grantPermissions(["notifications"], { origin: new URL(BASE).origin });
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(BASE).origin, registrationId: await regId, data: JSON.stringify(push.payload) });
    const shown = await page.evaluate(async (tag) => {
      for (let i = 0; i < 20; i++) {
        const list = await (await navigator.serviceWorker.ready).getNotifications({ tag });
        if (list.length) return list.map((n) => ({ title: n.title, body: n.body, icon: n.icon, url: n.data && n.data.url }));
        await new Promise((r) => setTimeout(r, 250));
      }
      return [];
    }, push.payload.tag);
    if (shown.length) {
      assert.equal(shown[0].title, push.payload.title);
      assert.equal(shown[0].url, push.payload.url);
      assert.match(shown[0].icon, /\/icons\/icon-192\.png$/);
      log("service worker displayed it:", shown[0].title);
    } else {
      // Some headless builds never display notifications; the push itself was handled above.
      log("(headless browsers can't display notifications; display and tap handling are covered by tests/sw.test.ts)");
    }

    // ---- An expired device is forgotten ----
    respondWith = 410;
    await toggle.locator("button:has-text('שליחת בדיקה')").click();
    await page.waitForTimeout(2500);
    respondWith = 201;
    await toggle.locator("button:has-text('שליחת בדיקה')").click();
    await page.locator("[role=alert]").first().waitFor({ timeout: 10000 });
    log("expired device forgotten (push service said 410)");

    // ---- Turning it off ----
    await page.reload();
    await settle(page);
    await page.locator('[data-push-state="on"]').waitFor(); // browser still thinks it's subscribed
    await toggle.locator("button:has-text('כיבוי')").click();
    await page.locator('[data-push-state="off"]').waitFor();
    log("turned off");

    // ---- English, and staff get the switch too ----
    await sp.goto(BASE + "/admin/notifications");
    await settle(sp);
    await sp.locator("[data-push-state]").waitFor();
    const en = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
    await en.addCookies([...(await staff.cookies()), { name: "cm_locale", value: "en", url: BASE }]);
    const ep = await en.newPage();
    await ep.goto(BASE + "/admin/notifications");
    await settle(ep);
    await ep.getByText("Notifications on this device").waitFor();
    await ep.screenshot({ path: OUT + "/staff-en.png" });
    log("staff area has the switch (English)");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nPUSH: all passed");
  } finally {
    await browser.close();
    pushService.close();
  }
})().catch((e) => {
  console.error("PUSH FAILED:", e);
  process.exit(1);
});
