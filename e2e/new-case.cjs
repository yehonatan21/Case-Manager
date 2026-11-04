const { chromium } = require("playwright");
const assert = require("node:assert/strict");
// Case manager opens a request for a client (new and existing), in Hebrew and English on mobile.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/new-case.cjs
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "new-case");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "he-IL",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/login?as=manager%40example.com");
  await page.waitForTimeout(1200);
  const code = (
    await page.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText()
  ).match(/\d{6}/)[0];
  await page.fill('input[autocomplete="one-time-code"]', code);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname.startsWith("/admin"), {
    timeout: 20000,
  });
  await page.goto(BASE + "/admin/cases");
  await page.waitForTimeout(1000);
  await page.click("a[href='/admin/cases/new']");
  await page.waitForURL(/\/admin\/cases\/new/);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: OUT + "/new-existing.png", fullPage: true });
  await page.click("button:has-text('לקוח חדש')");
  await page.getByLabel("שם מלא").fill("לקוחה מהטלפון");
  await page
    .getByLabel("דוא״ל", { exact: false })
    .first()
    .fill(`phone-${Date.now()}@example.com`);
  await page.getByLabel("כותרת").fill("חידוש אשרת עבודה");
  await page
    .getByLabel("מה הלקוח צריך?")
    .fill("שיחה טלפונית: האשרה פגה בחודש הבא.");
  await page.screenshot({ path: OUT + "/new-client.png", fullPage: true });
  await page.click("button:has-text('יצירת הבקשה')");
  await page.waitForURL(
    (u) => /^\/admin\/cases\/[0-9a-f-]{36}$/.test(new URL(u).pathname),
    { timeout: 20000 },
  );
  await page.waitForTimeout(1200);
  assert.match(
    await page.locator("h1").first().innerText(),
    /חידוש אשרת עבודה/,
  );
  await page.screenshot({ path: OUT + "/created.png" });
  // From a customer profile, the client is preselected.
  await page.goto(BASE + "/admin/customers");
  await page.waitForTimeout(800);
  await page.locator("tbody a").first().click();
  await page.waitForTimeout(1000);
  await page.click("a:has-text('בקשה חדשה ללקוח הזה')");
  await page.waitForURL(/customer=/);
  await page.waitForTimeout(1000);
  assert.notEqual(await page.locator("select").first().inputValue(), "");
  // English, mobile
  const en = await b.newContext({
    viewport: { width: 390, height: 844 },
    locale: "en-US",
  });
  await en.addCookies(await ctx.cookies());
  await en.addCookies([{ name: "cm_locale", value: "en", url: BASE }]);
  const p2 = await en.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(BASE + "/admin/cases/new");
  await p2.waitForTimeout(1200);
  await p2.getByText("New request for a client").first().waitFor();
  assert.equal(
    await p2.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "no horizontal scroll",
  );
  await p2.screenshot({ path: OUT + "/mobile-en.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("NEW CASE UI: passed");
  await b.close();
})().catch((e) => {
  console.error("NEW CASE UI FAILED:", e);
  process.exit(1);
});
