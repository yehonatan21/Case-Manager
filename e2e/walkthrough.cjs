// End-to-end walkthrough of the MVP "definition of done" (customer + case manager), with screenshots.
//
// Requires a running app with demo data and the console email provider (sign-in codes are shown on screen):
//   npm run dev            # in another terminal
//   npm run e2e            # BASE=http://localhost:3000 by default
// Needs Playwright with Chromium available: `npm i -D playwright && npx playwright install chromium`.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "screenshots");
require("fs").mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || "http://localhost:3000";
const log = (...a) => console.log("•", ...a);

async function devCode(page) {
  const el = page.locator("text=/(קוד שלך הוא|your code is) \\d{6}/");
  await el.first().waitFor({ timeout: 15000 });
  const t = await el.first().innerText();
  return t.match(/\d{6}/)[0];
}

async function login(page, email) {
  await page.goto(BASE + "/login"); await page.waitForTimeout(1200);
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');
  const code = await devCode(page);
  await page.fill('input[autocomplete="one-time-code"]', code);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|portal)/, { timeout: 20000 });
}

async function logout(ctx) {
  await ctx.clearCookies();
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1, locale: "he-IL" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  // 1. Home
  await page.goto(BASE + "/"); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-home-he.png`, fullPage: true });
  log("home ok, dir =", await page.getAttribute("html", "dir"));

  // 2. Free-text request → AI conversation
  await page.fill("#start-text", "אני רוצה לעבור עם המשפחה למדינה באירופה ולא יודע מאיפה מתחילים");
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/intake\/[0-9a-f-]+$/, { timeout: 30000 });
  await page.locator("text=/מדינה מסוימת/").first().waitFor({ timeout: 20000 });
  log("intake started:", page.url());
  // answer: type, quick reply, skip
  const bubbles = () => page.locator(".rounded-ss-sm").count();
  const answer = async (fn) => {
    const before = await bubbles();
    await fn();
    await page.waitForFunction((n) => document.querySelectorAll(".rounded-ss-sm").length > n, before, { timeout: 20000 });
  };
  await answer(async () => {
    await page.fill("#intake-input", "פורטוגל או ספרד");
    await page.keyboard.press("Enter");
  });
  await answer(() => page.click("button:has-text('איכות חיים')"));
  await answer(() => page.click("button:has-text('3–4')"));
  await answer(() => page.click("button:has-text('דלג')"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-intake-chat-he.png` });
  log("intake answered");

  // 3. Finish & review
  await page.click("button:has-text('סיום ומעבר לסיכום')");
  await page.waitForURL(/\/review/, { timeout: 30000 });
  await page.locator("h1:has-text('האם הבנו נכון')").waitFor();
  await page.screenshot({ path: `${OUT}/03-review-he.png`, fullPage: true });
  const title = await page.inputValue("input >> nth=0");
  log("review title:", title);

  // 4. Account creation + OTP + submit
  await page.click("button:has-text('שליחת הבקשה לבדיקה')");
  await page.locator("text=/פרטים ליצירת קשר/").waitFor();
  const email = `e2e${Date.now()}@example.com`;
  await page.getByLabel("שם מלא").fill("ישראל ישראלי");
  await page.getByLabel("כתובת דוא״ל").fill(email);
  await page.locator('input[type="checkbox"]').nth(0).check(); // AI consent
  await page.locator('input[type="checkbox"]').nth(1).check(); // terms
  await page.screenshot({ path: `${OUT}/04-account-he.png`, fullPage: true });
  await page.click("button:has-text('שליחת קוד אימות')");
  const code = await devCode(page);
  await page.fill('input[autocomplete="one-time-code"]', code);
  await page.click("button:has-text('אימות ושליחת הבקשה')");
  await page.waitForURL(/\/portal\/cases\/[0-9a-f-]+\?submitted=1/, { timeout: 30000 });
  await page.locator("text=/הבקשה נשלחה בהצלחה/").waitFor();
  const caseUrl = page.url().split("?")[0];
  const caseNumber = (await page.locator("text=/CASE-\\d{4}-\\d{4}/").first().innerText()).match(/CASE-\d{4}-\d{4}/)[0];
  await page.screenshot({ path: `${OUT}/05-case-submitted-he.png`, fullPage: true });
  log("case submitted:", caseNumber, caseUrl);
  await logout(ctx);

  // 5. Case manager: dashboard, inbox, workspace with AI summary
  await login(page, "admin@example.com");
  await page.goto(BASE + "/admin"); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/06-admin-dashboard-he.png`, fullPage: true });
  await page.goto(BASE + "/admin/inbox"); await page.waitForTimeout(1200);
  // The list is a table on a wide screen and cards on a phone; use the one on screen.
  await page.locator(`text=${caseNumber} >> visible=true`).waitFor();
  await page.screenshot({ path: `${OUT}/07-admin-inbox-he.png`, fullPage: true });
  await page.click(`text=${caseNumber} >> visible=true`);
  await page.waitForURL(/\/admin\/cases\//);
  const adminCaseUrl = page.url().split("?")[0];
  await page.locator("text=/מה הלקוח מבקש|יצירת סיכום/").first().waitFor({ timeout: 20000 });
  if (await page.locator("button:has-text('יצירת סיכום')").count()) {
    await page.click("button:has-text('יצירת סיכום')");
    await page.locator("text=/מה הלקוח מבקש/").waitFor({ timeout: 20000 });
  }
  await page.screenshot({ path: `${OUT}/08-workspace-he.png`, fullPage: true });
  log("workspace with AI summary");

  // assign to me → under review; ask client a clarifying question via copilot draft
  await page.click("button:has-text('שיוך אליי')");
  await page.waitForTimeout(1500);
  await page.click("button:has-text('הכן שאלות ללקוח')");
  await page.locator("text=/טיוטה \\(לא נשלחה\\)/").waitFor({ timeout: 20000 });
  await page.click("button:has-text('העברה לחלון ההודעה')");
  await page.locator("#composer-thread").waitFor();
  const draftText = await page.inputValue("#composer-thread");
  log("AI draft in composer:", draftText.slice(0, 60).replace(/\n/g, " "));
  await page.getByText("סימון כבקשת מידע מהלקוח").click();
  await page.click("button:has-text('שליחה') >> nth=-1");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/09-workspace-message-sent-he.png`, fullPage: true });

  // 6. Customer replies (status returns to review)
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "he-IL" });
  const mob = await ctx2.newPage();
  mob.on("pageerror", (e) => errors.push("mobile pageerror: " + e.message));
  await login(mob, email);
  await mob.goto(caseUrl); await mob.waitForTimeout(1200);
  await mob.locator("text=/מענה לשאלת הצוות/").first().waitFor({ timeout: 15000 });
  await mob.screenshot({ path: `${OUT}/10-mobile-case-action-he.png`, fullPage: true });
  await mob.click("button:has-text('למענה')");
  await mob.fill("#composer-thread", "המטרה היא לעבור בקיץ הבא. לאחד מאיתנו יש דרכון פורטוגלי.");
  await mob.click("button:has-text('שליחה')");
  await mob.waitForTimeout(1500);
  log("customer replied");

  // 7. Staff prepares a quote with AI draft (prices only from the price list), then sends
  await page.goto(adminCaseUrl + "?tab=quotes"); await page.waitForTimeout(1200);
  await page.click("button:has-text('הכנת הצעת מחיר')");
  await page.waitForURL(/\/admin\/quotes\//);
  await page.click("button:has-text('הצע טיוטה באמצעות AI')");
  await page.locator("text=/הטיוטה הוחלה/").waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/11-quote-editor-he.png`, fullPage: true });
  page.once("dialog", (dlg) => dlg.accept());
  await page.click("button:has-text('אישור ושליחה ללקוח')");
  await page.waitForURL(/\/admin\/cases\/.*tab=quotes/, { timeout: 20000 });
  log("quote sent");

  // 8. Customer approves and pays (first a failure, then success)
  await mob.goto(caseUrl + "?tab=quote"); await mob.waitForTimeout(1200);
  await mob.locator("text=/אישור הצעת המחיר/").first().waitFor({ timeout: 15000 });
  await mob.screenshot({ path: `${OUT}/12-mobile-quote-he.png`, fullPage: true });
  await mob.getByText("קראתי את ההצעה ואני מאשר/ת אותה").click();
  await mob.click("button:has-text('אישור הצעת המחיר')");
  await mob.locator("button:has-text('מעבר לתשלום מאובטח')").waitFor({ timeout: 15000 });
  await mob.click("button:has-text('מעבר לתשלום מאובטח')");
  await mob.waitForURL(/\/pay\/mock\//);
  await mob.click("button:has-text('סימולציית כישלון')");
  await mob.waitForURL(/payment=failed/);
  await mob.locator("text=/התשלום לא הושלם/").first().waitFor();
  log("failed payment does not activate case");
  await mob.click("button:has-text('מעבר לתשלום מאובטח')");
  await mob.waitForURL(/\/pay\/mock\//);
  await mob.screenshot({ path: `${OUT}/13-mobile-checkout-he.png`, fullPage: true });
  await mob.click("button:has-text('תשלום')");
  await mob.waitForURL(/payment=success/);
  await mob.locator("text=/התשלום התקבל ואושר/").waitFor({ timeout: 15000 });
  await mob.screenshot({ path: `${OUT}/14-mobile-paid-he.png`, fullPage: true });
  log("payment confirmed → case active");

  // 9. Staff: AI task plan, document request
  await page.goto(adminCaseUrl); await page.waitForTimeout(1200);
  await page.locator("button:has-text('הצעת רשימת משימות')").first().click();
  await page.locator("text=/משימות מוצעות/").waitFor({ timeout: 20000 });
  await page.click("button:has-text('יצירת המשימות שנבחרו')");
  await page.waitForTimeout(1500);
  await page.goto(adminCaseUrl + "?tab=documents"); await page.waitForTimeout(1200);
  await page.click("button:has-text('בקשת מסמך מהלקוח')");
  await page.getByLabel("שם המסמך").fill("צילום דרכון פורטוגלי");
  await page.locator("dialog button:has-text('שליחה')").click();
  await page.waitForTimeout(1500);
  log("tasks created, document requested");

  // 10. Realtime: customer sees the request; uploads a PDF
  await mob.goto(caseUrl + "?tab=documents"); await mob.waitForTimeout(1200);
  await mob.locator("text=/צילום דרכון פורטוגלי/").first().waitFor({ timeout: 15000 });
  const pdf = path.join(OUT, "passport.pdf");
  require("fs").writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const chooser = mob.waitForEvent("filechooser");
  await mob.click("button:has-text('העלאת קובץ') >> nth=0");
  await (await chooser).setFiles(pdf);
  await mob.waitForTimeout(2500);
  await mob.screenshot({ path: `${OUT}/15-mobile-documents-he.png`, fullPage: true });
  log("customer uploaded document");

  // 11. Staff approves the document and completes the case
  await page.goto(adminCaseUrl + "?tab=documents"); await page.waitForTimeout(1200);
  await page.locator("button:has-text('אישור')").first().click();
  await page.waitForTimeout(1200);
  page.once("dialog", (dlg) => dlg.accept());
  await page.click("button:has-text('השלמת התיק')");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/16-workspace-completed-he.png`, fullPage: true });

  // 12. Language switch → English (LTR) on the customer's case
  await mob.goto(caseUrl); await mob.waitForTimeout(1200);
  await mob.getByRole("button", { name: /^(English|EN)\b/ }).first().click();
  await mob.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 15000 });
  await mob.locator("text=/The whole process is complete|What needs to be done now/").first().waitFor({ timeout: 15000 });
  await mob.screenshot({ path: `${OUT}/17-mobile-case-completed-en.png`, fullPage: true });
  log("switched to English, dir =", await mob.getAttribute("html", "dir"));

  // 13. Staff area in English
  await page.getByRole("button", { name: /^(English|EN)\b/ }).first().click();
  await page.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 15000 });
  await page.goto(BASE + "/admin"); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/18-admin-dashboard-en.png`, fullPage: true });
  await page.goto(adminCaseUrl + "?tab=timeline"); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/19-workspace-timeline-en.png`, fullPage: true });

  // 14. Access control: another customer cannot open this case
  const ctx3 = await browser.newContext();
  const other = await ctx3.newPage();
  await login(other, "biz@example.com");
  const r = await other.goto(caseUrl); await other.waitForTimeout(1200);
  const blocked = (await other.locator("text=/התיק לא נמצא|Case not found/").count()) > 0;
  const api = await other.request.get(BASE + "/api/cases/" + caseUrl.split("/").pop());
  log("other customer blocked:", blocked, "API status", api.status());

  // 15. Home in English, mobile
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: "en-US" });
  const m2 = await ctx4.newPage();
  await m2.goto(BASE + "/"); await m2.waitForTimeout(1200);
  await m2.screenshot({ path: `${OUT}/20-mobile-home-en.png`, fullPage: true });
  const overflow = await m2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  log("mobile horizontal overflow:", overflow);

  console.log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
