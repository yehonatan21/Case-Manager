// Account flows in the browser: header entry point, sign-in vs. registration, unknown-email offer,
// sign out / sign in again, one-click demo admin, and the same page in English.
// Requires a running app in demo mode (sign-in codes on screen): BASE=http://localhost:3000 node e2e/accounts.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE || "http://localhost:3000";
const log = (...a) => console.log("•", ...a);

async function codeOnScreen(page) {
  const t = await page.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 });
  return t.match(/\d{6}/)[0];
}
const settle = (p) => p.waitForTimeout(1200); // let React hydrate before interacting

(async () => {
  const browser = await browser_();
  async function browser_() {
    return chromium.launch();
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Header: a single "My account" entry, no Register button.
  await page.goto(BASE + "/");
  await settle(page);
  const header = page.locator("header");
  assert.equal(await header.locator("a[href='/register']").count(), 0, "no Register button in header");
  assert.equal(await header.getByText("החשבון שלי").count(), 1, "My account button");
  await header.getByText("החשבון שלי").click();
  await page.waitForURL(/\/login/);
  await settle(page);
  log("header has only 'My account'");

  // 2. Unknown email: no code, registration offered with the email prefilled.
  const email = `e2e-acct-${Date.now()}@example.com`;
  await page.fill("input[type=email]", email);
  await page.click("button[type=submit]");
  await page.locator("text=/לא מצאנו חשבון/").waitFor();
  assert.equal(await page.locator('input[autocomplete="one-time-code"]').count(), 0, "no code step for unknown email");
  await page.click("a:has-text('הרשמה עם הכתובת הזו')");
  await page.waitForURL(/\/register\?email=/);
  await settle(page);
  assert.equal(await page.getByLabel("כתובת דוא״ל").inputValue(), email);
  log("unknown email → registration offered, email prefilled");

  // 3. Register with an email code → personal area.
  await page.getByLabel("שם מלא").fill("בדיקת הרשמה");
  await page.locator('input[type="checkbox"]').nth(1).check(); // terms
  await page.click("button:has-text('שליחת קוד אימות')");
  await page.fill('input[autocomplete="one-time-code"]', await codeOnScreen(page));
  await page.click("button:has-text('אימות ויצירת החשבון')");
  await page.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
  assert.match(await page.locator("h1").first().innerText(), /שלום/);
  log("registered → portal");

  // 4. Sign out, then sign back in with the same email (now a known account).
  await page.click("button[aria-label='התנתקות']");
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await page.goto(BASE + "/login");
  await settle(page);
  await page.fill("input[type=email]", email);
  await page.click("button[type=submit]");
  await page.fill('input[autocomplete="one-time-code"]', await codeOnScreen(page));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
  log("signed out and back in with a code");

  // 5. Wrong code is rejected.
  await ctx.clearCookies();
  await page.goto(BASE + "/login");
  await settle(page);
  await page.fill("input[type=email]", email);
  await page.click("button[type=submit]");
  const real = await codeOnScreen(page);
  await page.fill('input[autocomplete="one-time-code"]', real === "000000" ? "111111" : "000000");
  await page.click("button[type=submit]");
  await page.locator("[role=alert]").first().waitFor();
  assert.equal(new URL(page.url()).pathname, "/login");
  log("wrong code rejected");

  // 6. Form switch both ways, URL and heading follow.
  await page.goto(BASE + "/login");
  await settle(page);
  await page.click("button:has-text('הרשמה')");
  assert.equal(new URL(page.url()).pathname, "/register");
  assert.equal(await page.locator("h1").innerText(), "יצירת חשבון");
  await page.click("button:has-text('התחברות')");
  assert.equal(new URL(page.url()).pathname, "/login");
  log("sign-in ⇄ register switch");

  // 7. One-click demo admin → staff area → all requests.
  await page.click("a[href^='/login?as=admin']");
  await page.fill('input[autocomplete="one-time-code"]', await codeOnScreen(page));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname === "/admin", { timeout: 20000 });
  await page.goto(BASE + "/admin/cases?status=all");
  await settle(page);
  assert.ok((await page.locator("tbody tr").count()) >= 4, "admin sees all requests");
  log("demo admin → all requests");

  // 8. Sign-in page in English (LTR).
  const en = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  const p2 = await en.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(BASE + "/login");
  await settle(p2);
  assert.equal(await p2.getAttribute("html", "dir"), "ltr");
  await p2.getByText("Don't have an account yet?").waitFor();
  await p2.click("button:has-text('Register')");
  assert.equal(await p2.locator("h1").innerText(), "Create an account");
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, "no horizontal scroll on mobile");
  log("English, mobile: switch works, no overflow");

  assert.deepEqual(errors, [], "no page errors");
  console.log("\nACCOUNT FLOWS: all passed");
  await browser.close();
})().catch((e) => {
  console.error("ACCOUNT FLOWS FAILED:", e);
  process.exit(1);
});
