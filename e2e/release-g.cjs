// Release G in the browser: the shared filter bar on Quotes, Payments and Tasks (search, filters, date range,
// sort, paging, all in the address so Back and reload keep them; "Clear filters" keeps the tab), the menu's
// counters (read out as what they count, never zero), and the Settings tab kept in the address (reload, Back,
// unknown values). axe runs on each list; the phone layout doesn't scroll sideways.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-g.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-g");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(800);

async function signIn(browser, email, viewport = { width: 1440, height: 900 }) {
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
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const run = () =>
    page.evaluate(async () =>
      (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map(
        (x) =>
          `${x.id}: ${x.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 2)
            .join(", ")}`,
      ),
    );
  let v = await run();
  if (v.length === 1 && v[0].startsWith("document-title")) {
    await page.waitForTimeout(1500);
    v = await run();
  }
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}
const results = async (p) => Number((await p.locator("[role=search] + p[role=status]").innerText()).match(/\d+/)[0]);
const apply = async (p) => {
  await p.locator("[role=search] button[type=submit]").click();
  await p.waitForLoadState("networkidle");
  await settle(p);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);

    // ---- 1. Quotes: search by case number, filter by status, clear ----
    await admin.goto(BASE + "/admin/quotes");
    await settle(admin);
    const total = await results(admin);
    assert.ok(total > 0, "demo data has quotes");
    await axe(admin, "quotes with the filter bar");
    const caseNo = (await admin.locator("tbody tr td:first-child a").first().innerText()).trim();
    await admin.getByLabel("חיפוש", { exact: true }).fill(caseNo);
    await apply(admin);
    assert.match(admin.url(), new RegExp(`q=${encodeURIComponent(caseNo)}`));
    const found = await admin.locator("tbody tr td:first-child").allInnerTexts();
    assert.ok(found.length > 0 && found.every((t) => t.trim() === caseNo), "only that case's quotes");
    assert.equal(await results(admin), found.length);
    // The filters survive a reload (they're in the address).
    await admin.reload();
    await settle(admin);
    assert.equal(await admin.getByLabel("חיפוש", { exact: true }).inputValue(), caseNo);
    await admin.getByRole("link", { name: "ניקוי הסינון" }).click();
    await admin.waitForURL(BASE + "/admin/quotes");
    await settle(admin);
    assert.equal(await results(admin), total);
    await admin.getByLabel("סטטוס").selectOption("approved");
    await apply(admin);
    const badges = await admin.locator("tbody tr td:last-child").allInnerTexts();
    assert.ok(
      badges.every((t) => t.includes("אושרה")),
      "only approved quotes",
    );
    // A date range in the future finds nothing, and says so.
    await admin.getByLabel("מתאריך").fill("01012099");
    await apply(admin);
    assert.match(admin.url(), /from=2099-01-01/);
    await admin.getByText("לא נמצאו תוצאות שתואמות לסינון.").waitFor();
    log("quotes: search, status and date filters live in the address and clear back to the full list");

    // ---- 2. Payments: sort by amount, amount range ----
    await admin.goto(BASE + "/admin/payments");
    await settle(admin);
    await axe(admin, "payments with the filter bar");
    await admin.getByLabel("מיון").selectOption("amount_asc");
    await apply(admin);
    const amounts = async () => (await admin.locator("tbody tr td:nth-child(4)").allInnerTexts()).map((t) => Number(t.replace(/[^\d.]/g, "")));
    const asc = await amounts();
    assert.ok(asc.length > 0, "demo data has payments");
    assert.deepEqual(
      asc,
      [...asc].sort((a, b) => a - b),
      "sorted by amount, lowest first",
    );
    // From the highest amount up keeps only those; above it, nothing.
    const top = asc[asc.length - 1];
    await admin.getByLabel("מסכום").fill(String(top));
    await apply(admin);
    assert.ok((await amounts()).length > 0 && (await amounts()).every((a) => a >= top), "only payments from the minimum up");
    await admin.getByLabel("מסכום").fill(String(top + 1));
    await apply(admin);
    assert.equal(await results(admin), 0);
    assert.match(admin.url(), /sort=amount_asc/);
    await admin.screenshot({ path: OUT + "/payments.png", fullPage: true });
    log("payments: sorted by amount and filtered by a minimum amount");

    // ---- 3. Tasks: the tab stays while filtering and clearing ----
    await admin.goto(BASE + "/admin/tasks?scope=all");
    await settle(admin);
    await axe(admin, "tasks with the filter bar");
    await admin.getByLabel("עדיפות").selectOption("high");
    await apply(admin);
    assert.match(admin.url(), /scope=all/);
    assert.match(admin.url(), /priority=high/);
    const prios = await admin.locator("tbody tr td:nth-child(4)").allInnerTexts();
    assert.ok(
      prios.every((t) => t.trim() === "גבוהה"),
      "only high-priority tasks",
    );
    assert.equal(await admin.getByRole("link", { name: "כל המשימות" }).getAttribute("aria-current"), "page");
    await admin.getByRole("link", { name: "ניקוי הסינון" }).click();
    await admin.waitForURL(BASE + "/admin/tasks?scope=all");
    log("tasks: filtering and clearing keep the All tasks tab");

    // ---- 4. Menu counters: read as what they count; no zeros ----
    const side = admin.locator("aside");
    const counted = await side.locator("nav a").evaluateAll((links) => links.map((a) => ({ name: a.textContent, badge: a.querySelector("span[aria-hidden]")?.textContent ?? null })));
    for (const l of counted) if (l.badge !== null) assert.notEqual(l.badge, "0", "a counter of zero isn't shown");
    const withBadge = counted.filter((l) => l.badge !== null);
    assert.ok(withBadge.length > 0, "demo data has something waiting");
    for (const l of withBadge) assert.match(l.name, /, \d+ /, `the counter on "${l.name}" is read as what it counts`);
    log(`menu counters: ${withBadge.map((l) => l.name.replace(/\s+/g, " ")).join(" | ")}`);

    // ---- 5. Settings: the tab is in the address ----
    await admin.goto(BASE + "/admin/settings");
    await settle(admin);
    await admin.locator("#tab-users").click();
    await admin.waitForURL(/tab=users/);
    await admin.locator("#tab-integrations").click();
    await admin.waitForURL(/tab=integrations/);
    await admin.goBack();
    await admin.waitForURL(/tab=users/);
    // The tab's content comes from the server; wait for it.
    await admin.locator("#panel-users:not([aria-busy])").waitFor();
    assert.equal(await admin.locator("#tab-users").getAttribute("aria-selected"), "true");
    await admin.reload();
    await settle(admin);
    assert.equal(await admin.locator("#tab-users").getAttribute("aria-selected"), "true");
    await admin.goto(BASE + "/admin/settings?tab=bogus");
    await settle(admin);
    assert.equal(await admin.locator("#tab-general").getAttribute("aria-selected"), "true");
    log("settings: the open tab is kept in the address, Back returns to the previous tab, unknown tabs show General");

    // ---- 6. On a phone the filter bar wraps and the page doesn't scroll sideways ----
    const phone = await signIn(browser, "admin@example.com", { width: 390, height: 844 });
    watch(phone);
    await phone.goto(BASE + "/admin/payments");
    await settle(phone);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    await phone.screenshot({ path: OUT + "/payments-phone.png", fullPage: true });
    log("on a phone the filter bar fits the screen");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE G: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE G FAILED:", e);
  process.exit(1);
});
