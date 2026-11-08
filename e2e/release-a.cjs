// Production readiness in the browser: an admin fills in the accessibility coordinator in Settings and the public
// statement shows it; the System health page shows each integration (axe); a case manager starts work on a case
// before payment and must give a reason, which only the team sees; the customer list is searched on the server
// and paged. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-a.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-a");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

async function signIn(browser, email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "he" });
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
  const run = () => page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  let v = await run();
  // A page refreshing after a save briefly has no <title> while Next.js streams the new one in: check again once.
  if (v.length === 1 && v[0].startsWith("document-title")) {
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
    v = await run();
  }
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  try {
    // ---- 1. The accessibility coordinator ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings");
    await settle(admin);
    await admin.getByLabel("שם רכז/ת הנגישות").fill("נועה לוי");
    await admin.getByLabel("טלפון רכז/ת הנגישות").fill("03-5551234");
    await admin.getByLabel("דוא״ל רכז/ת הנגישות").fill("access@office.co.il");
    await admin.getByLabel("זמן מענה (ימי עבודה)").fill("5");
    await axe(admin, "settings with accessibility contact");
    await admin.locator("button:has-text('שמירה')").first().click();
    await admin.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    const pub = await (await browser.newContext({ locale: "he" })).newPage();
    watch(pub);
    await pub.goto(BASE + "/accessibility");
    await pub.getByText("רכז/ת נגישות: נועה לוי").waitFor();
    await pub.locator("a[href='mailto:access@office.co.il']").waitFor();
    await pub.locator("a[href='tel:035551234']").waitFor();
    await pub.getByText("נשיב לפנייה בתוך 5 ימי עבודה.").waitFor();
    assert.equal(await pub.getByText("[").count(), 0, "no placeholders left");
    await axe(pub, "accessibility statement");
    log("the accessibility statement shows the coordinator saved in Settings");

    // ---- 2. System health ----
    // Under Settings; the old address forwards there.
    await admin.goto(BASE + "/admin/health");
    await admin.waitForURL(/\/admin\/settings\?tab=health/);
    await settle(admin);
    await admin.getByRole("tab", { name: "תקינות המערכת", selected: true }).waitFor();
    await admin.getByRole("heading", { name: "תקינות המערכת", level: 2 }).waitFor();
    for (const name of ["בינה מלאכותית", "דוא״ל", "תשלומים", "קבלות וחשבוניות", "משימות מתוזמנות"]) await admin.getByRole("heading", { name, level: 3 }).waitFor();
    // Demo mode uses the test checkout: flagged, with what to do.
    await admin.getByText("לא מחובר ספק תשלומים").waitFor();
    await axe(admin, "system health");
    await admin.screenshot({ path: OUT + "/health.png", fullPage: true });
    const api = (method, url, data) => admin.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    assert.equal((await api("GET", "/api/admin/health")).status, 200);
    log("the System health page lists every integration");

    // ---- 3. Starting work before payment needs a reason ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    assert.equal((await manager.request.get(BASE + "/api/admin/health")).status(), 403, "health is for admins");
    const mapi = (method, url, data) => manager.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    // Opened by the case manager, so it's theirs.
    const created = await mapi("POST", "/api/admin/cases", { customer: { email: `walkin-${stamp}@example.com`, name: `לקוח מזדמן ${stamp}`, phone: `054-${String(stamp).slice(-7, -4)}-${String(stamp).slice(-4)}`, customerType: "private", locale: "he" }, title: `תיק ללא תשלום ${stamp}`, description: "שולם בהעברה", serviceCategory: "other", urgency: "normal" });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const caseId = created.json.data.id;
    // Cases the team opens start under review; move there if not.
    await mapi("PATCH", `/api/cases/${caseId}/status`, { status: "under_review" });
    const noReason = await mapi("PATCH", `/api/cases/${caseId}/status`, { status: "active" });
    assert.equal(noReason.status, 422);
    await manager.goto(`${BASE}/admin/cases/${caseId}`);
    await settle(manager);
    await manager.locator("#ws-status").selectOption("active");
    const dlg = manager.locator("dialog[open]");
    await dlg.waitFor();
    const confirm = dlg.locator("button:has-text('התחלת הטיפול')");
    assert.equal(await confirm.isDisabled(), true, "a reason first");
    await dlg.getByLabel("אחר", { exact: true }).check();
    assert.equal(await confirm.isDisabled(), true, "'other' needs details");
    await dlg.getByLabel("שולם בדרך אחרת (העברה בנקאית, מזומן, צ׳ק)").check();
    await dlg.getByLabel("פרטים").fill("אסמכתא 99812");
    await axe(manager, "start without payment dialog");
    await manager.screenshot({ path: OUT + "/activation.png" });
    await confirm.click();
    await manager.locator("[role=status]", { hasText: "הסטטוס עודכן" }).first().waitFor();
    await settle(manager);
    await manager.goto(`${BASE}/admin/cases/${caseId}?tab=timeline`);
    await settle(manager);
    await manager.getByText("הטיפול התחיל בלי תשלום מקוון: שולם בדרך אחרת (העברה בנקאית, מזומן, צ׳ק)").first().waitFor();
    await manager.getByText("אסמכתא 99812").first().waitFor();
    log("starting work before payment asked for a reason and kept it in the history");

    // ---- 4. Customers: server-side search and pages ----
    await admin.goto(`${BASE}/admin/customers?q=${encodeURIComponent(`054${String(stamp).slice(-7)}`)}`);
    await settle(admin);
    await admin.locator("tbody tr", { hasText: `לקוח מזדמן ${stamp}` }).waitFor();
    assert.equal(await admin.locator("tbody tr").count(), 1, "found by phone typed without dashes");
    await axe(admin, "customers search");
    await admin.goto(`${BASE}/admin/customers?q=${encodeURIComponent("no-such-client-" + stamp)}`);
    await admin.getByText("לא נמצאו לקוחות שתואמים לחיפוש.").waitFor();
    await admin.goto(`${BASE}/admin/cases?status=all&q=${encodeURIComponent("שולם בהעברה")}`);
    await settle(admin);
    await admin.getByText(`תיק ללא תשלום ${stamp}`).first().waitFor();
    log("customers are found by phone, cases by description");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE A: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE A FAILED:", e);
  process.exit(1);
});
