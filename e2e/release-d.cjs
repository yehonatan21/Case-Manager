// Release D in the browser: an admin sets a team member's cost per hour; the team member times work on a case and
// adds an expense; the admin sees the case's profit and the Reports section; staff confirm a document's details and
// the checks flag an expired document with another name; an admin adds a contact to a client's company, who then
// sees the company's cases on the portal. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-d.cjs
const { chromium } = require("playwright");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-d");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

async function signIn(browser, email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "he", timezoneId: "Asia/Jerusalem" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  await settle(p);
  const code = (await p.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await p.fill('input[autocomplete="one-time-code"]', code);
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
  return p;
}
async function axe(page, label) {
  // Next.js streams the <title> in just after the page loads; check once it's there, as a visitor would.
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}
async function pdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText("Passport", { x: 50, y: 780, size: 16, font });
  return Buffer.from(await doc.save());
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  try {
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    const api = (page, method, url, data) => page.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));

    // ---- 1. Cost per hour (Settings → Users) ----
    await admin.goto(BASE + "/admin/settings?tab=users");
    await settle(admin);
    const cost = admin.getByLabel("עלות לשעה: דנה לוי");
    // A different value each run, so it's saved again.
    await cost.fill(String(150 + (stamp % 100)));
    await cost.blur();
    await admin.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    log("admin set the case manager's cost per hour");

    // ---- 2. The case manager times work and adds an expense ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    const created = await api(manager, "POST", "/api/admin/cases", { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title: `רווחיות ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const caseId = created.json.data.id;
    await manager.goto(`${BASE}/admin/cases/${caseId}?tab=time`);
    await settle(manager);
    await manager.locator("button:has-text('הפעלת שעון')").click();
    await manager.getByRole("timer").waitFor();
    await manager.getByLabel("על מה עבדת? (לא חובה)").fill("קריאת התיק");
    await manager.locator("button:has-text('עצירה')").click();
    await manager.getByText("קריאת התיק").waitFor();
    await manager.getByLabel("שעות", { exact: true }).fill("1");
    await manager.getByLabel("דקות", { exact: true }).fill("30");
    await manager.getByLabel("הערה", { exact: true }).fill("מילוי טפסים");
    await manager.locator("fieldset button:has-text('הוספה')").click();
    await manager.getByText("מילוי טפסים").waitFor();
    await manager.getByLabel("תיאור (למשל אגרה ממשלתית)").fill("אגרת רשות האוכלוסין");
    await manager.getByLabel("סכום").fill("150");
    await manager.locator("button:has-text('הוספת הוצאה')").click();
    await manager.getByText("אגרת רשות האוכלוסין").waitFor();
    assert.equal(await manager.getByRole("heading", { name: "רווחיות", exact: true }).count(), 0, "case managers don't see money");
    await axe(manager, "time and costs tab");
    await manager.screenshot({ path: OUT + "/time.png", fullPage: true });
    log("the case manager timed work, added 1:30 by hand and an expense");

    // ---- 3. The admin sees the profit, and the report ----
    await admin.goto(`${BASE}/admin/cases/${caseId}?tab=time`);
    await settle(admin);
    await admin.getByRole("heading", { name: "רווחיות", exact: true }).waitFor();
    await admin.getByText("עלות זמן הצוות").waitFor();
    await axe(admin, "profit card");
    await admin.goto(`${BASE}/admin/reports?preset=7d`);
    await settle(admin);
    await admin.getByRole("heading", { name: "זמן ורווחיות" }).waitFor();
    await admin.locator("table", { hasText: "שעות לפי איש צוות" }).getByText("דנה לוי").waitFor();
    await axe(admin, "reports with profitability");
    log("the admin sees the case's profit and the time report");

    // ---- 4. Document details and checks ----
    const up = await admin.request.fetch(`${BASE}/api/cases/${caseId}/documents`, { method: "POST", multipart: { file: { name: "passport.pdf", mimeType: "application/pdf", buffer: await pdf() }, title: "דרכון", visibility: "client" } });
    assert.equal(up.status(), 200);
    await admin.goto(`${BASE}/admin/cases/${caseId}?tab=documents`);
    await settle(admin);
    const row = admin.locator("li", { hasText: "דרכון" }).first();
    await row.locator("summary:has-text('פרטים ובדיקות')").click();
    await row.getByLabel("שם מלא כפי שמופיע").fill("ישראל ישראלי");
    await row.getByLabel("תוקף עד").fill("2020-01-01");
    await row.locator("button:has-text('שמירת הפרטים')").click();
    await admin.locator("[role=status]", { hasText: "הפרטים נשמרו" }).first().waitFor();
    await settle(admin);
    const summary = admin.getByRole("region", { name: /דברים לבדוק במסמכים/ });
    await summary.getByText(/פג תוקף/).waitFor();
    await summary.getByText(/לא תואם/).waitFor();
    await axe(admin, "document checks");
    await admin.screenshot({ path: OUT + "/doc-checks.png", fullPage: true });
    log("an expired passport with another name is flagged");

    // ---- 5. A company contact ----
    await admin.goto(`${BASE}/admin/customers?q=${encodeURIComponent("biz@example.com")}`);
    await settle(admin);
    await admin.locator("tbody a").first().click();
    await admin.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}/);
    await settle(admin);
    await admin.getByRole("heading", { name: "חברה ואנשי קשר" }).waitFor();
    await admin.locator("button:has-text('הוספת איש קשר')").click();
    const email = `office-${stamp}@example.com`;
    const form = admin.locator("fieldset", { hasText: "הוספת איש קשר" });
    await form.getByLabel(/^שם/).fill("מנהלת המשרד");
    await form.getByLabel(/^דוא״ל/).fill(email);
    await axe(admin, "company contacts");
    await form.locator("button:has-text('הוספת איש קשר')").click();
    await admin.locator("[role=status]", { hasText: "איש הקשר נוסף" }).first().waitFor();
    await settle(admin);
    await admin.getByText(email).waitFor();
    await admin.screenshot({ path: OUT + "/company.png", fullPage: true });
    const contact = await signIn(browser, email, { width: 390, height: 844 });
    watch(contact);
    await contact.goto(`${BASE}/portal/cases`);
    await settle(contact);
    await contact.getByText("נפתח עבור רוני גולן").first().waitFor();
    await axe(contact, "company cases on the portal");
    log("the new company contact sees the company's cases");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE D: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE D FAILED:", e);
  process.exit(1);
});
