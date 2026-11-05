// Reports in the browser: an admin sees revenue, the funnel, handling times, requests by type and status, and the
// team table; switches the period; exports to Excel (a real .xlsx). Finance sees revenue but not the team; a case
// manager the reverse; other staff get no reports. axe runs on the page.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/reports.cjs
const { chromium } = require("playwright");
const { unzipSync, strFromU8 } = require("fflate");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "reports");
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
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    // ---- Admin: everything ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin");
    await settle(admin);
    await admin.click("nav a:has-text('דוחות')");
    await admin.waitForURL(/\/admin\/reports/);
    await settle(admin);
    for (const h of ["הכנסות", "מפנייה לתשלום", "זמני טיפול", "פניות לפי סוג שירות", "פניות לפי סטטוס נוכחי", "עומס הצוות"]) await admin.getByRole("heading", { name: h, exact: true }).waitFor();
    // The demo data has requests in the last 30 days.
    const requests = await admin.locator("section[aria-labelledby=funnel-title] p.text-2xl").first().innerText();
    assert.ok(Number(requests.replace(/\D/g, "")) > 0, "requests counted");
    // A bar is keyboard-focusable and shows a tooltip.
    const bar = admin.locator("section[aria-labelledby=type-title] li[tabindex='0']").first();
    await bar.focus();
    await admin.locator("[role=tooltip]").first().waitFor();
    await axe(admin, "reports (admin)");
    await admin.screenshot({ path: OUT + "/admin.png", fullPage: true });
    log("admin sees revenue, funnel, times, types, statuses and the team");

    // Switch the period.
    await admin.selectOption("select[name=preset]", "year");
    await admin.click("button:has-text('הצגה')");
    await admin.waitForURL(/preset=year/);
    await settle(admin);
    await admin.getByRole("heading", { name: "הכנסות לפי חודש" }).waitFor();
    // A custom range.
    await admin.selectOption("select[name=preset]", "");
    await admin.fill("input[name=from]", "2021-01-01");
    await admin.fill("input[name=to]", "2021-01-31");
    await admin.click("button:has-text('הצגה')");
    await settle(admin);
    await admin.getByText("לא נפתחו פניות בתקופה הזו.").first().waitFor();
    log("period presets and custom ranges work");

    // Excel export.
    await admin.goto(BASE + "/admin/reports?preset=90d");
    await settle(admin);
    const href = await admin.locator("a:has-text('ייצוא ל-Excel')").getAttribute("href");
    const res = await admin.request.get(BASE + href);
    assert.equal(res.status(), 200);
    assert.match(res.headers()["content-type"], /spreadsheetml/);
    assert.match(res.headers()["content-disposition"], /report-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx/);
    const files = unzipSync(new Uint8Array(await res.body()));
    const wb = strFromU8(files["xl/workbook.xml"]);
    for (const name of ["סיכום", "הכנסות לפי חודש", "עומס הצוות", "פניות"]) assert.ok(wb.includes(`name="${name}"`), `sheet ${name}`);
    assert.ok(strFromU8(files["xl/worksheets/sheet1.xml"]).includes('rightToLeft="1"'));
    log("the Excel export has the sheets");

    // ---- Finance: revenue, no team ----
    const fin = await signIn(browser, "finance@example.com");
    watch(fin);
    await fin.goto(BASE + "/admin/reports");
    await settle(fin);
    await fin.getByRole("heading", { name: "הכנסות", exact: true }).waitFor();
    assert.equal(await fin.getByRole("heading", { name: "עומס הצוות" }).count(), 0);
    // ---- Case manager: the team, no revenue ----
    const cm = await signIn(browser, "manager@example.com");
    watch(cm);
    await cm.goto(BASE + "/admin/reports");
    await settle(cm);
    await cm.getByRole("heading", { name: "עומס הצוות" }).waitFor();
    assert.equal(await cm.getByRole("heading", { name: "הכנסות", exact: true }).count(), 0);
    // ---- Other staff: no reports ----
    const st = await signIn(browser, "staff@example.com");
    await st.goto(BASE + "/admin/reports");
    await st.waitForURL((u) => new URL(u).pathname === "/admin");
    assert.equal((await st.request.get(BASE + "/api/admin/reports/export")).status(), 403);
    log("finance sees revenue only, the case manager operations only, other staff nothing");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nREPORTS: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("REPORTS FAILED:", e);
  process.exit(1);
});
