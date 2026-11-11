// The iPhone/Android app (mobile/) runs the live site in a web view with Capacitor's bridge injected as
// window.Capacitor. Headless Chromium has no app around it, so the bridge is replaced with a stand-in that
// answers the native calls the site makes (push permission and registration, the system browser, launch
// URL) and lets the test fire native events (a tapped notification, the sign-in link opening the app).
// Everything on the site's side is real: the switch, the API, the server, the redirects.
//   BASE=http://localhost:3000 node e2e/native-app.cjs   (server in demo mode)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "native-app");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1200);
const codeOnScreen = async (p) => (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];

/** The app's bridge, as the site sees it. Calls are logged in window.__app.calls. */
function fakeApp({ platform, deviceToken }) {
  const listeners = new Map();
  // Kept across page loads, like the app's own log would be.
  const calls = JSON.parse(localStorage.getItem("e2e.calls") || "[]");
  let n = 0;
  window.__app = {
    calls,
    emit(plugin, event, data) {
      for (const [, l] of listeners) if (l.key === `${plugin}:${event}`) l.cb(data);
    },
  };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
    nativeCallback(plugin, method, opts, cb) {
      const id = `cb${++n}`;
      if (method === "addListener") listeners.set(id, { key: `${plugin}:${opts.eventName}`, cb });
      return id;
    },
    async nativePromise(plugin, method, opts) {
      calls.push({ plugin, method, opts });
      localStorage.setItem("e2e.calls", JSON.stringify(calls));
      switch (`${plugin}.${method}`) {
        case "PushNotifications.checkPermissions":
          return { receive: localStorage.getItem("e2e.notif") || "prompt" };
        case "PushNotifications.requestPermissions":
          localStorage.setItem("e2e.notif", "granted");
          return { receive: "granted" };
        case "PushNotifications.register":
          setTimeout(() => window.__app.emit("PushNotifications", "registration", { value: deviceToken }), 50);
          return {};
        case "PushNotifications.removeListener":
          listeners.delete(opts.callbackId);
          return {};
        case "App.getLaunchUrl":
          return localStorage.getItem("e2e.launch") ? { url: localStorage.getItem("e2e.launch") } : undefined;
        default:
          return {};
      }
    },
  };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const deviceToken = crypto.randomBytes(32).toString("hex");
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL", isMobile: true, hasTouch: true });
    await ctx.addInitScript(fakeApp, { platform: "ios", deviceToken });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));

    // ---- Sign-in return: a cancelled or broken Google sign-in lands on the sign-in page with the reason ----
    await page.goto(BASE + "/login");
    await settle(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.nativeApp), "ios", "the site knows it runs in the app");
    await page.evaluate(() => window.__app.emit("App", "appUrlOpen", { url: "app.casemanager.mobile://auth?error=google_cancelled" }));
    await page.waitForURL((u) => new URL(u).searchParams.get("error") === "google_cancelled", { timeout: 15000 });
    await page.getByText("ההתחברות עם Google בוטלה").waitFor();
    log("a cancelled Google sign-in returns to the app's sign-in page with the reason");

    await page.evaluate(() => localStorage.setItem("cm_app_sign_in_verifier", "v".repeat(43)));
    await page.evaluate(() => window.__app.emit("App", "appUrlOpen", { url: `app.casemanager.mobile://auth?code=${"c".repeat(43)}` }));
    await page.waitForURL((u) => new URL(u).searchParams.get("error") === "google_failed", { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem("cm_app_sign_in_verifier")), null, "the secret is used once");
    assert.ok((await page.evaluate(() => window.__app.calls)).some((c) => c.plugin === "Browser" && c.method === "close"), "the system browser is closed");
    log("a code the server doesn't accept is refused, and the secret is discarded");

    // Cold start from the link: handled once, not on every page after it.
    await page.evaluate(() => localStorage.setItem("e2e.launch", "app.casemanager.mobile://auth?error=google_cancelled"));
    await page.goto(BASE + "/login?x=1");
    await page.waitForURL((u) => new URL(u).searchParams.get("error") === "google_cancelled", { timeout: 15000 });
    await settle(page);
    await page.goto(BASE + "/login?x=2");
    await settle(page);
    assert.equal(new URL(page.url()).searchParams.get("x"), "2", "the launch link isn't handled twice");
    await page.evaluate(() => localStorage.removeItem("e2e.launch"));
    log("a cold start from the sign-in link is handled once");

    // ---- Push: the switch registers the phone with Apple/Google, not browser push ----
    await page.goto(BASE + "/login?as=client%40example.com");
    await settle(page);
    await page.fill('input[autocomplete="one-time-code"]', await codeOnScreen(page));
    await page.click("button[type=submit]");
    await page.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
    await page.goto(BASE + "/portal/notifications");
    await settle(page);
    const toggle = page.locator('[data-push-kind="app"]');
    await toggle.and(page.locator('[data-push-state="off"]')).waitFor();
    await toggle.locator("button:has-text('הפעלה')").click();
    await page.locator('[data-push-kind="app"][data-push-state="on"]').waitFor({ timeout: 15000 });
    await page.locator("[role=status]", { hasText: "ההתראות הופעלו" }).first().waitFor();
    await page.getByText("פעיל בטלפון הזה").waitFor();
    const on = await page.evaluate(async (t) => (await (await fetch(`/api/push/native?token=${t}`)).json()).data.on, deviceToken);
    assert.equal(on, true, "the server has this phone's token");
    const calls = await page.evaluate(() => window.__app.calls.map((c) => `${c.plugin}.${c.method}`));
    assert.ok(calls.includes("PushNotifications.requestPermissions") && calls.includes("PushNotifications.register"), "asked the phone, then registered");
    assert.ok(!(await page.evaluate(() => navigator.serviceWorker.getRegistration("/").then((r) => !!r))), "no browser push in the app");
    await page.screenshot({ path: OUT + "/push-on.png", fullPage: true });
    log("push turned on for the phone; the server has its token");

    await page.reload();
    await settle(page);
    await page.locator('[data-push-kind="app"][data-push-state="on"]').waitFor();
    log("still on after a reload");

    // ---- A tapped notification opens its page; links to other sites are ignored ----
    await page.evaluate((b) => window.__app.emit("PushNotifications", "pushNotificationActionPerformed", { actionId: "tap", notification: { data: { url: `${b}/portal/profile` } } }), BASE);
    await page.waitForURL((u) => new URL(u).pathname === "/portal/profile", { timeout: 15000 });
    await page.evaluate(() => window.__app.emit("PushNotifications", "pushNotificationActionPerformed", { actionId: "tap", notification: { data: { url: "https://evil.example/x" } } }));
    await settle(page);
    assert.equal(new URL(page.url()).pathname, "/portal/profile");
    log("a tapped notification opens its page; other sites are ignored");

    // ---- Turning it off removes the phone ----
    await page.goto(BASE + "/portal/notifications");
    await settle(page);
    await page.locator('[data-push-kind="app"] button:has-text("כיבוי")').click();
    await page.locator('[data-push-kind="app"][data-push-state="off"]').waitFor({ timeout: 15000 });
    const off = await page.evaluate(async (t) => (await (await fetch(`/api/push/native?token=${t}`)).json()).data.on, deviceToken);
    assert.equal(off, false);
    log("turned off: the server forgot the phone");

    // ---- Blocked in the phone's settings: says where to allow it ----
    await page.evaluate(() => localStorage.setItem("e2e.notif", "denied"));
    await page.reload();
    await settle(page);
    await page.locator('[data-push-kind="app"][data-push-state="denied"]').waitFor();
    await page.getByText("בהגדרות הטלפון").waitFor();
    log("blocked notifications point to the phone's settings");

    // ---- The return page from the system browser ----
    const ret = await ctx.newPage();
    await ret.goto(`${BASE}/app-return?error=google_cancelled`);
    await ret.getByRole("link", { name: "חזרה לאפליקציה" }).waitFor();
    assert.equal(await ret.getByRole("link", { name: "חזרה לאפליקציה" }).getAttribute("href"), "app.casemanager.mobile://auth?error=google_cancelled");
    await ret.close();
    log("the system browser's return page links back into the app");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nNATIVE APP: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("NATIVE APP FAILED:", e);
  process.exit(1);
});
