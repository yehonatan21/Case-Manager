// A case manager opens requests for clients in the browser: new client, existing client (from the
// customer profile), left unassigned (inbox), staff email refused, the new client signs in and sees it,
// and the page in English on mobile.
// Requires a running app in demo mode (sign-in codes on screen): BASE=http://localhost:3000 node e2e/new-case.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "new-case");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1200); // let React hydrate before interacting
const isCasePage = (u) => /^\/admin\/cases\/[0-9a-f-]{36}$/.test(new URL(u).pathname);

async function signIn(page, email) {
  await page.goto(BASE + "/login?as=" + encodeURIComponent(email));
  await settle(page);
  const code = (await page.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await page.fill('input[autocomplete="one-time-code"]', code);
  await page.click("button[type=submit]");
}

async function fillRequest(page, title) {
  await page.getByLabel("כותרת").fill(title);
  await page.getByLabel("מה הלקוח צריך?").fill("שיחה טלפונית: האשרה פגה בחודש הבא.");
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  const clientEmail = `phone-${stamp}@example.com`;

  // 1. Manager: "New request" on the cases page opens the form; Create waits for a client to be chosen.
  await signIn(page, "manager@example.com");
  await page.waitForURL((u) => new URL(u).pathname.startsWith("/admin"), { timeout: 20000 });
  await page.goto(BASE + "/admin/cases");
  await settle(page);
  await page.click("a[href='/admin/cases/new']");
  await page.waitForURL(/\/admin\/cases\/new/);
  await settle(page);
  assert.equal(await page.locator("button:has-text('יצירת הבקשה')").isDisabled(), true, "create disabled until a client is chosen");
  await page.screenshot({ path: OUT + "/existing-client.png", fullPage: true });
  log("form opens from the cases page; create waits for a client");

  // 2. New client → lands on the new case, assigned to me and under review.
  await page.click("button:has-text('לקוח חדש')");
  await page.getByLabel("שם מלא").fill("לקוחה מהטלפון");
  await page.locator("input[type=email]").fill(clientEmail);
  await page.locator("input[type=tel]").fill("050-1234567");
  await fillRequest(page, `חידוש אשרת עבודה ${stamp}`);
  await page.screenshot({ path: OUT + "/new-client.png", fullPage: true });
  await page.click("button:has-text('יצירת הבקשה')");
  await page.waitForURL(isCasePage, { timeout: 20000 });
  await settle(page);
  assert.match(await page.locator("h1").first().innerText(), new RegExp(`חידוש אשרת עבודה ${stamp}`));
  await page.getByText(clientEmail).first().waitFor();
  await page.getByText("בבדיקה ראשונית").first().waitFor();
  await page.screenshot({ path: OUT + "/created.png" });
  log("new client → case page, under review");

  // 3. A staff email is refused with a message, and the form stays.
  await page.goto(BASE + "/admin/cases/new");
  await settle(page);
  await page.click("button:has-text('לקוח חדש')");
  await page.getByLabel("שם מלא").fill("לא לקוח");
  await page.locator("input[type=email]").fill("staff@example.com");
  await fillRequest(page, "לא אמור להיווצר");
  await page.click("button:has-text('יצירת הבקשה')");
  await page.locator("[role=alert]", { hasText: "שייכת לאיש צוות" }).first().waitFor();
  assert.equal(new URL(page.url()).pathname, "/admin/cases/new");
  log("staff email refused with a clear message");

  // 4. From the client's profile the client is preselected; unassigned → appears in the inbox.
  await page.goto(BASE + "/admin/customers");
  await settle(page);
  await page.locator("tbody a", { hasText: "לקוחה מהטלפון" }).first().click();
  await page.waitForURL(/\/admin\/customers\//);
  await settle(page);
  await page.click("a:has-text('בקשה חדשה ללקוח הזה')");
  await page.waitForURL(/customer=/);
  await settle(page);
  assert.notEqual(await page.locator("select").first().inputValue(), "", "client preselected");
  await fillRequest(page, `בקשה לתיבה ${stamp}`);
  await page.getByLabel("שיוך אליי").uncheck();
  await page.click("button:has-text('יצירת הבקשה')");
  await page.waitForURL(isCasePage, { timeout: 20000 });
  await page.goto(BASE + "/admin/inbox");
  await settle(page);
  await page.getByText(`בקשה לתיבה ${stamp}`).first().waitFor();
  log("existing client preselected; unassigned request is in the inbox");

  // 5. The new client signs in with that email and sees both requests in the portal.
  const clientCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
  const cp = await clientCtx.newPage();
  cp.on("pageerror", (e) => errors.push(e.message));
  await cp.goto(BASE + "/login");
  await settle(cp);
  await cp.fill("input[type=email]", clientEmail);
  await cp.click("button[type=submit]");
  const code = (await cp.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await cp.fill('input[autocomplete="one-time-code"]', code);
  await cp.click("button[type=submit]");
  await cp.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
  await settle(cp);
  await cp.getByText(`חידוש אשרת עבודה ${stamp}`).first().waitFor();
  await cp.getByText(`בקשה לתיבה ${stamp}`).first().waitFor();
  await cp.screenshot({ path: OUT + "/client-portal.png" });
  log("the client signs in and sees the requests");

  // 6. English, mobile.
  const en = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  await en.addCookies([...(await ctx.cookies()), { name: "cm_locale", value: "en", url: BASE }]);
  const p2 = await en.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(BASE + "/admin/cases/new");
  await settle(p2);
  assert.equal(await p2.getAttribute("html", "dir"), "ltr");
  await p2.getByText("New request for a client").first().waitFor();
  await p2.click("button:has-text('New client')");
  await p2.getByLabel("Full name").waitFor();
  assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "no horizontal scroll");
  await p2.screenshot({ path: OUT + "/mobile-en.png", fullPage: true });
  log("English, mobile: no overflow");

  assert.deepEqual(errors, [], "no page errors");
  console.log("\nNEW CASE UI: all passed");
  await browser.close();
})().catch((e) => {
  console.error("NEW CASE UI FAILED:", e);
  process.exit(1);
});
