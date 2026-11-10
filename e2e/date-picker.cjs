// The app's date picker (every date field): it opens on today (or the chosen day) with focus on it; the arrows move
// in reading direction (left = next day in Hebrew), PageDown to the next month, Enter chooses and the field shows
// DD/MM/YYYY; a quick pick fills a day, and in a From/To filter both; Esc closes the calendar only, even inside a
// dialog, and focus returns to the calendar button; days outside the allowed range can't be chosen; on a phone it's
// a sheet from the bottom; in English it reads left to right. axe runs with the calendar open.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/date-picker.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "date-picker");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(800);
const pad = (n) => String(n).padStart(2, "0");
const officeToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const display = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const plus = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function signIn(browser, email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "he", timezoneId: "Asia/Jerusalem", ...opts });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  await settle(p);
  const code = (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await p.fill('input[autocomplete="one-time-code"]', code);
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
  return p;
}
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () =>
    (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } })).violations.map(
      (x) =>
        `${x.id}: ${x.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 2)
          .join(", ")}`,
    ),
  );
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}
const focusedDay = (p) => p.evaluate(() => document.activeElement?.getAttribute("data-day"));
const picker = (p) => p.locator("[role=dialog]:has([role=grid])");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    const today = officeToday();
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);

    // ---- 1. Keyboard: focus on today; left = next day (Hebrew); Enter chooses ----
    await admin.goto(BASE + "/admin/quotes");
    await settle(admin);
    const from = admin.getByLabel("מתאריך");
    const fromButton = admin.locator("#filter-from").locator("..").getByRole("button", { name: "בחירת תאריך" });
    await fromButton.click();
    await picker(admin).waitFor();
    await admin.waitForFunction(() => document.activeElement?.hasAttribute("data-day"));
    assert.equal(await focusedDay(admin), today, "focus starts on today");
    assert.equal(await admin.locator(`[data-day="${today}"]`).getAttribute("aria-current"), "date");
    await axe(admin, "date picker open (Hebrew)");
    await admin.screenshot({ path: OUT + "/range-he.png" });
    await admin.keyboard.press("ArrowLeft");
    assert.equal(await focusedDay(admin), plus(today, 1), "the left arrow is the next day in Hebrew");
    await admin.keyboard.press("ArrowUp");
    assert.equal(await focusedDay(admin), plus(today, -6));
    await admin.keyboard.press("Enter");
    await picker(admin).waitFor({ state: "detached" });
    assert.equal(await from.inputValue(), display(plus(today, -6)));
    assert.equal(await admin.evaluate(() => document.activeElement?.getAttribute("aria-label")), "בחירת תאריך", "focus returns to the calendar button");
    log("keyboard: focus on today, the arrows follow reading direction, Enter chooses, focus comes back");

    // ---- 2. PageDown changes month; Esc closes ----
    await fromButton.click();
    await admin.waitForFunction(() => document.activeElement?.hasAttribute("data-day"));
    const before = await picker(admin).getByRole("heading").innerText();
    await admin.keyboard.press("PageDown");
    assert.notEqual(await picker(admin).getByRole("heading").innerText(), before, "PageDown shows the next month");
    await admin.keyboard.press("Escape");
    await picker(admin).waitFor({ state: "detached" });
    log("PageDown moves a month; Esc closes");

    // ---- 3. A range quick pick fills From and To, and the filter uses them ----
    await fromButton.click();
    await picker(admin).getByRole("button", { name: "החודש", exact: true }).click();
    await picker(admin).waitFor({ state: "detached" });
    assert.equal(await from.inputValue(), display(`${today.slice(0, 8)}01`));
    assert.equal(await admin.getByLabel("עד תאריך").inputValue(), display(today));
    await admin.locator("[role=search] button[type=submit]").click();
    await admin.waitForURL(new RegExp(`from=${today.slice(0, 8)}01.*to=${today}`));
    // The calendar shades the chosen range.
    await admin.locator("#filter-to").locator("..").getByRole("button", { name: "בחירת תאריך" }).click();
    assert.equal(
      await picker(admin)
        .locator(`[data-day="${today.slice(0, 8)}01"]`)
        .getAttribute("aria-selected"),
      "true",
    );
    await admin.keyboard.press("Escape");
    log("'This month' fills both From and To, and the filter applies them");

    // ---- 4. Inside a dialog: Esc closes the calendar, not the dialog; a quick pick fills the day ----
    await admin.goto(BASE + "/admin/meetings?new=event");
    await settle(admin);
    const dlg = admin.locator("dialog[open]");
    await dlg.waitFor();
    await dlg.getByRole("button", { name: "בחירת תאריך" }).click();
    await picker(admin).waitFor();
    await admin.keyboard.press("Escape");
    await picker(admin).waitFor({ state: "detached" });
    assert.equal(await admin.locator("dialog[open]").count(), 1, "the dialog stays open");
    await dlg.getByRole("button", { name: "בחירת תאריך" }).click();
    await picker(admin).getByRole("button", { name: "מחר" }).click();
    assert.equal(await dlg.locator("input[placeholder='DD/MM/YYYY']").first().inputValue(), display(plus(today, 1)));
    await admin.screenshot({ path: OUT + "/in-dialog.png" });
    log("inside a dialog, Esc closes just the calendar; 'Tomorrow' fills the date");

    // ---- 5. Days before the earliest allowed day can't be chosen (booking a meeting) ----
    await admin.goto(BASE + "/admin/cases");
    await settle(admin);
    const caseHref = await admin.locator("tbody tr a").first().getAttribute("href");
    await admin.goto(BASE + caseHref + "?tab=meetings&new=meeting");
    await settle(admin);
    const booking = admin.locator("dialog[open]");
    await booking.waitFor();
    await booking.getByRole("button", { name: "בחירת תאריך" }).click();
    const yesterday = picker(admin).locator(`[data-day="${plus(today, -1)}"]`);
    if (await yesterday.count()) {
      assert.equal(await yesterday.getAttribute("aria-disabled"), "true");
      await yesterday.dispatchEvent("click");
      assert.equal(await picker(admin).count(), 1, "a disabled day doesn't close the calendar");
    }
    await admin.keyboard.press("Escape");
    log("days before the earliest allowed day are disabled");

    // ---- 6. On a phone: a sheet from the bottom ----
    const phone = await signIn(browser, "admin@example.com", { viewport: { width: 390, height: 844 } });
    watch(phone);
    await phone.goto(BASE + "/admin/tasks?scope=all");
    await settle(phone);
    await phone.locator("#filter-from").locator("..").getByRole("button", { name: "בחירת תאריך" }).click();
    await picker(phone).waitFor();
    const box = await picker(phone).boundingBox();
    assert.ok(box.y + box.height >= 843 && box.width >= 389, "a full-width sheet at the bottom");
    const cell = await picker(phone).locator(`[data-day="${today}"] > span`).boundingBox();
    assert.ok(cell.width >= 44 && cell.height >= 44, "days are at least 44 px");
    await axe(phone, "date picker on a phone");
    await phone.screenshot({ path: OUT + "/phone.png" });
    await phone.keyboard.press("Escape");
    log("on a phone it's a bottom sheet with 44 px days");

    // ---- 7. English: left to right ----
    await admin.context().addCookies([{ name: "cm_locale", value: "en", url: BASE }]);
    await admin.goto(BASE + "/admin/payments");
    await settle(admin);
    await admin.locator("#filter-from").locator("..").getByRole("button", { name: "Choose a date" }).click();
    await admin.waitForFunction(() => document.activeElement?.hasAttribute("data-day"));
    await admin.keyboard.press("ArrowRight");
    assert.equal(await focusedDay(admin), plus(today, 1), "the right arrow is the next day in English");
    await axe(admin, "date picker open (English)");
    await admin.screenshot({ path: OUT + "/range-en.png" });
    await admin.keyboard.press("Escape");
    await admin.context().addCookies([{ name: "cm_locale", value: "he", url: BASE }]);
    log("in English the calendar reads left to right");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nDATE PICKER: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("DATE PICKER FAILED:", e);
  process.exit(1);
});
