// Admin adds team members in Settings → Users: a new email, an email that registered as a client,
// and an email refused with a clear reason; then changes a role.
// Requires a running app in demo mode (sign-in codes on screen): BASE=http://localhost:3000 node e2e/team.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "team");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1200);
const codeOnScreen = async (p) => (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const stamp = Date.now();

  // Someone registers on the site as a client (e.g. to try it).
  const reg = await browser.newContext({ locale: "he-IL" });
  const rp = await reg.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  const registered = `registered-${stamp}@example.com`;
  await rp.goto(BASE + "/register?email=" + encodeURIComponent(registered));
  await settle(rp);
  await rp.getByLabel("שם מלא").fill("שילה לפידות");
  await rp.locator('input[type="checkbox"]').nth(1).check();
  await rp.click("button:has-text('שליחת קוד אימות')");
  await rp.fill('input[autocomplete="one-time-code"]', await codeOnScreen(rp));
  await rp.click("button:has-text('אימות ויצירת החשבון')");
  await rp.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
  log("a client registered:", registered);

  // The admin opens Settings → Users.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/login?as=admin%40example.com");
  await settle(page);
  await page.fill('input[autocomplete="one-time-code"]', await codeOnScreen(page));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname.startsWith("/admin"), { timeout: 20000 });
  await page.goto(BASE + "/admin/settings?tab=users");
  await settle(page);

  // The add form is the card holding the email field; the list below has a role select per row.
  const form = page.locator("div", { has: page.locator("input[type=email]") }).filter({ has: page.locator("button:has-text('הוספה')") }).last();
  async function add(email, name, role) {
    await form.getByLabel("שם", { exact: true }).fill(name);
    await form.locator("input[type=email]").fill(email);
    await form.locator("select").selectOption(role);
    await form.locator("button:has-text('הוספה')").click();
  }
  const row = (email) => page.locator("tbody tr", { hasText: email });

  // 1. A new email.
  const fresh = `new-member-${stamp}@example.com`;
  await add(fresh, "איש צוות חדש", "staff");
  await page.locator("[role=status]", { hasText: "נוסף" }).first().waitFor();
  await row(fresh).waitFor();
  assert.match(await row(fresh).innerText(), /הוזמן|Invited/);
  log("new email added as invited");

  // 2. The email that registered as a client becomes a case manager (the reported bug).
  await add(registered, "שילה לפידות", "case_manager");
  await page.locator("[role=status]", { hasText: "הפך לחשבון צוות" }).first().waitFor();
  await row(registered).waitFor();
  assert.equal(await row(registered).locator("select").inputValue(), "case_manager");
  await page.screenshot({ path: OUT + "/users.png", fullPage: true });
  log("registered client became a case manager");

  // 3. Clear reasons instead of the generic "updated meanwhile" message.
  await add(fresh, "שוב", "staff");
  await page.locator("[role=alert]", { hasText: "כבר שייכת לאיש צוות" }).first().waitFor();
  await add("client@example.com", "לקוח", "staff");
  await page.locator("[role=alert]", { hasText: "שייכת ללקוח שיש לו בקשות" }).first().waitFor();
  assert.equal(await page.locator("text=עודכן במקביל").count(), 0);
  log("duplicates refused with clear messages");

  // 4. Change a role in the list, and it sticks after a reload.
  await row(fresh).locator("select").selectOption("finance");
  await page.waitForTimeout(1500);
  await page.reload();
  await settle(page);
  assert.equal(await row(fresh).locator("select").inputValue(), "finance");
  log("role change saved");

  // 5. The converted account signs in to the staff area.
  const m = await browser.newContext({ locale: "he-IL" });
  const mp = await m.newPage();
  mp.on("pageerror", (e) => errors.push(e.message));
  await mp.goto(BASE + "/login");
  await settle(mp);
  await mp.fill("input[type=email]", registered);
  await mp.click("button[type=submit]");
  await mp.fill('input[autocomplete="one-time-code"]', await codeOnScreen(mp));
  await mp.click("button[type=submit]");
  await mp.waitForURL((u) => new URL(u).pathname.startsWith("/admin"), { timeout: 20000 });
  log("the new case manager signs in to the staff area");

  assert.deepEqual(errors, [], "no page errors");
  console.log("\nTEAM: all passed");
  await browser.close();
})().catch((e) => {
  console.error("TEAM FAILED:", e);
  process.exit(1);
});
