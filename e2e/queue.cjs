// The Work queue in the browser: a case manager sets a deadline and "waiting on others" on a case (and sees the
// summary bar), finds it in the right views, changes several cases at once, saves a view, and checks the team's
// workload; a staff member's queue shows only their cases. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/queue.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "queue");
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
const isoDay = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  try {
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    const api = (method, url, data) => manager.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    const make = async (title) => {
      const r = await api("POST", "/api/admin/cases", { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title, description: "בדיקה", serviceCategory: "other", urgency: "normal" });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json.data.id;
    };
    const tag = `תור ${stamp}`;
    const [c1, c2, c3] = [await make(`${tag} א`), await make(`${tag} ב`), await make(`${tag} ג`)];

    // ---- 1. Deadline and "waiting on others" on the case ----
    await manager.goto(`${BASE}/admin/cases/${c1}`);
    await settle(manager);
    await manager.getByLabel("מועד התיק").fill(isoDay(-1));
    await manager.locator("button:has-text('שמירה')").first().click();
    await manager.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    await settle(manager);
    await manager.getByLabel("ממתין לגורם מחוץ למשרד").check();
    await manager.getByLabel("למי או למה (למשל רשות האוכלוסין)").fill("רשות האוכלוסין");
    await manager.locator("button:has-text('שמירה')").first().click();
    await manager.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    await settle(manager);
    // The summary bar: handled by, next step, deadline (late), last activity.
    const bar = manager.locator("dl").first();
    await bar.getByText("באיחור של 1 ימים").waitFor();
    await bar.getByText("ממתין ל: רשות האוכלוסין").waitFor();
    await axe(manager, "case with deadline and summary bar");
    await manager.screenshot({ path: OUT + "/case-summary.png" });
    log("a deadline and 'waiting on others' were set; the summary bar shows them");

    // ---- 2. The queue's views ----
    await manager.goto(`${BASE}/admin/queue?q=${encodeURIComponent(tag)}`);
    await settle(manager);
    await manager.getByRole("heading", { name: "תור עבודה", level: 1 }).waitFor();
    const rows = manager.locator("tbody tr");
    assert.equal(await rows.count(), 3, "my three new cases");
    // The late one comes first.
    assert.match(await rows.first().innerText(), new RegExp(`${tag} א`));
    await rows.first().getByText("רשות האוכלוסין").waitFor();
    await axe(manager, "work queue");
    await manager.screenshot({ path: OUT + "/queue.png", fullPage: true });
    await manager.goto(`${BASE}/admin/queue?view=overdue&q=${encodeURIComponent(tag)}`);
    await settle(manager);
    assert.equal(await rows.count(), 1);
    await manager.goto(`${BASE}/admin/queue?view=waiting_third_party&q=${encodeURIComponent(tag)}`);
    await settle(manager);
    assert.equal(await rows.count(), 1);
    log("late cases come first; 'late' and 'waiting on others' views filter them");

    // ---- 3. Bulk changes ----
    await manager.goto(`${BASE}/admin/queue?q=${encodeURIComponent(tag)}`);
    await settle(manager);
    await manager.getByLabel("בחירת כל התיקים בעמוד").check();
    const bulk = manager.getByRole("region", { name: "3 נבחרו" });
    await bulk.waitFor();
    await bulk.getByLabel("דחיפות…").selectOption("high");
    await manager.locator("[role=status]", { hasText: "3 תיקים עודכנו." }).first().waitFor();
    await settle(manager);
    assert.equal(await manager.locator("tbody tr", { hasText: "גבוהה" }).count(), 3);
    await manager.getByLabel("בחירת כל התיקים בעמוד").check();
    await bulk.getByLabel("מועד").fill(isoDay(3));
    await axe(manager, "bulk bar");
    await bulk.locator("button:has-text('החלה')").click();
    await manager.locator("[role=status]", { hasText: "3 תיקים עודכנו." }).first().waitFor();
    await settle(manager);
    await manager.goto(`${BASE}/admin/queue?view=due_soon&q=${encodeURIComponent(tag)}`);
    await settle(manager);
    assert.equal(await rows.count(), 3, "all three are due in 3 days");
    log("three cases changed at once (urgency, deadline)");

    // ---- 4. A saved view ----
    await manager.locator("button:has-text('שמירת התצוגה')").click();
    await manager.getByLabel("שם לתצוגה").fill(`מועדים ${stamp}`);
    await manager.locator("form button:has-text('שמירה')").click();
    await manager.locator("[role=status]", { hasText: "התצוגה נשמרה" }).first().waitFor();
    await settle(manager);
    await manager.goto(`${BASE}/admin/queue`);
    await settle(manager);
    await manager.getByRole("link", { name: `מועדים ${stamp}` }).click();
    await manager.waitForURL(/view=due_soon/);
    await settle(manager);
    assert.equal(await rows.count(), 3);
    log("the saved view opens the same filters");

    // ---- 5. Team workload ----
    await manager.goto(`${BASE}/admin/queue?view=team`);
    await settle(manager);
    await manager.getByRole("heading", { name: "עומס הצוות", level: 2 }).waitFor();
    await manager.locator("tbody tr", { hasText: "דנה לוי" }).waitFor();
    await axe(manager, "team workload");
    log("the team workload lists each member");

    // ---- 6. Staff see only their own ----
    const staff = await signIn(browser, "staff@example.com");
    watch(staff);
    await staff.goto(`${BASE}/admin/queue?view=all&q=${encodeURIComponent(tag)}`);
    await settle(staff);
    await staff.getByText("אין כאן כלום. כל הכבוד!").waitFor();
    assert.equal(await staff.getByRole("link", { name: /עומס הצוות/ }).count(), 0, "no team view for staff");
    assert.equal((await staff.request.post(BASE + "/api/cases/bulk", { data: { ids: [c2], action: { type: "urgency", urgency: "low" } } })).status(), 403);
    void c3;
    log("staff see only cases handed to them, and can't change cases in bulk");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nWORK QUEUE: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("WORK QUEUE FAILED:", e);
  process.exit(1);
});
