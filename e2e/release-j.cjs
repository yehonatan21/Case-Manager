// Release J in the browser: the staff search (Ctrl+K, or the header button): pages and records, arrow keys and
// Enter, Esc, nothing for 1 character, no clients for finance; and the case page: the next step up front with a
// way to the tasks, and the details and AI panels that can be hidden (remembered after a reload). axe throughout.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-j.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-j");
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
const box = (p) => p.getByRole("combobox", { name: "חיפוש תיקים, בקשות, לקוחות, הצעות מחיר ועמודים" });
const options = (p) => p.getByRole("option");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/cases");
    await settle(admin);
    const firstCase = admin.locator("tbody tr a").first();
    const caseNumber = (await firstCase.innerText()).match(/CASE-\d{4}-\d{4}/)[0];
    const caseHref = await firstCase.getAttribute("href");

    // ---- 1. Ctrl+K opens it; 1 character asks for more; a case number finds the case ----
    await admin.keyboard.press("Control+k");
    await box(admin).waitFor();
    assert.equal(await admin.evaluate(() => document.activeElement?.getAttribute("role")), "combobox", "focus is in the search field");
    await box(admin).fill("C");
    await admin.getByText("יש להקליד לפחות 2 תווים.").waitFor();
    await box(admin).fill(caseNumber);
    await options(admin).first().waitFor();
    const texts = await options(admin).allInnerTexts();
    assert.ok(
      texts.some((t) => t.includes(caseNumber)),
      "the case is found",
    );
    assert.equal(await options(admin).first().getAttribute("aria-selected"), "true");
    assert.ok((await box(admin).getAttribute("aria-activedescendant")).length > 0);
    await axe(admin, "search with results");
    await admin.screenshot({ path: OUT + "/search.png" });
    // Enter opens the highlighted record.
    const caseIndex = texts.findIndex((t) => t.includes("תיקים") && t.includes(caseNumber));
    for (let i = 0; i < caseIndex; i++) await box(admin).press("ArrowDown");
    await box(admin).press("Enter");
    await admin.waitForURL((u) => u.toString().endsWith(caseHref));
    log("Ctrl+K opens the search; a case number finds the case and Enter opens it");

    // ---- 2. Pages by name; Esc closes; the header button opens it too ----
    await admin.locator("header").getByRole("button", { name: "חיפוש" }).click();
    await box(admin).fill("תשלומ");
    await options(admin).filter({ hasText: "תשלומים" }).first().waitFor();
    await admin.keyboard.press("Escape");
    await box(admin).waitFor({ state: "detached" });
    log("pages are found by name; Esc closes; the header button opens the search");

    // ---- 3. Nothing found says so (and Ctrl+K reopens it straight after Esc) ----
    await admin.waitForTimeout(300);
    await admin.keyboard.press("Control+k");
    await box(admin).fill("zzzz-no-such-thing");
    await admin.getByText("לא נמצאו תוצאות.").waitFor();
    await admin.keyboard.press("Escape");
    log("a search with no matches says so");

    // ---- 4. Finance gets no clients ----
    const finance = await signIn(browser, "finance@example.com");
    watch(finance);
    await settle(finance);
    await finance.keyboard.press("Control+k");
    await box(finance).fill("example.com");
    await finance.waitForTimeout(1200);
    assert.ok(
      (await options(finance).allInnerTexts()).every((t) => !t.includes("לקוחות:")),
      "finance sees no clients",
    );
    log("finance doesn't get clients in the search");

    // ---- 5. The case page: next step first; hide and show the side panels ----
    await admin.goto(BASE + caseHref);
    await settle(admin);
    await admin.getByText("הצעד הבא").first().waitFor();
    const goTasks = admin.getByRole("button", { name: /למשימות/ });
    if (await goTasks.count()) {
      await goTasks.click();
      assert.equal(await admin.locator("#tab-tasks").getAttribute("aria-selected"), "true");
      log("the next step has a button to the tasks");
    }
    const hideAi = admin.getByRole("button", { name: "הסתרת AI Copilot" });
    await hideAi.click();
    assert.equal(await admin.locator("#ws-panel-copilot").isVisible(), false);
    await admin.getByRole("button", { name: "הסתרת פרטי לקוח ותיק" }).click();
    assert.equal(await admin.locator("#ws-panel-details").isVisible(), false);
    await axe(admin, "case with both side panels hidden");
    await admin.screenshot({ path: OUT + "/case-focused.png" });
    await admin.reload();
    await settle(admin);
    assert.equal(await admin.locator("#ws-panel-copilot").isVisible(), false, "still hidden after a reload");
    await admin.getByRole("button", { name: "הצגת AI Copilot" }).click();
    await admin.getByRole("button", { name: "הצגת פרטי לקוח ותיק" }).click();
    assert.equal(await admin.locator("#ws-panel-copilot").isVisible(), true);
    assert.equal(await admin.locator("#ws-panel-details").isVisible(), true);
    await axe(admin, "case with both side panels");
    await admin.screenshot({ path: OUT + "/case.png" });
    log("the details and AI panels can be hidden, stay hidden after a reload, and come back");

    // ---- 6. On a phone: the search button is an icon and the window fits ----
    const phone = await signIn(browser, "admin@example.com", { width: 390, height: 844 });
    watch(phone);
    await phone.locator("header").getByRole("button", { name: "חיפוש" }).click();
    await box(phone).fill(caseNumber);
    await options(phone).first().waitFor();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    await phone.screenshot({ path: OUT + "/search-phone.png" });
    log("the search works on a phone");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE J: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE J FAILED:", e);
  process.exit(1);
});
