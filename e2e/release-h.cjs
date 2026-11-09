// Release H in the browser: Quick Create ("+ New" in the staff header: only what the role may do; keyboard,
// Esc and a click outside close it; a task or a client meeting asks which case first and opens it with the form
// ready; a calendar event opens the event form), and the staff lists as cards on a phone (no sideways scrolling,
// each card opens its record). axe runs on the menu, the case picker and the cards.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-h.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-h");
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
const items = (p) => p.locator("header [data-qc-item]");
const openMenu = async (p) => {
  await p
    .locator("header")
    .getByRole("button", { name: /יצירה מהירה/ })
    .click();
  await items(p).first().waitFor();
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    // ---- 1. The menu: what the role may do; keyboard, Esc and outside click ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin");
    await settle(admin);
    await openMenu(admin);
    assert.deepEqual(
      (await items(admin).allInnerTexts()).map((s) => s.trim()),
      ["בקשה חדשה ללקוח", "משימה חדשה", "פגישה עם לקוח", "אירוע ביומן"],
    );
    // The first choice has focus; the arrow keys move between them.
    assert.equal(await admin.evaluate(() => document.activeElement?.textContent?.trim()), "בקשה חדשה ללקוח");
    await admin.keyboard.press("ArrowDown");
    assert.equal(await admin.evaluate(() => document.activeElement?.textContent?.trim()), "משימה חדשה");
    await admin.keyboard.press("End");
    assert.equal(await admin.evaluate(() => document.activeElement?.textContent?.trim()), "אירוע ביומן");
    await axe(admin, "quick create menu");
    await admin.screenshot({ path: OUT + "/menu.png" });
    await admin.keyboard.press("Escape");
    await items(admin).first().waitFor({ state: "detached" });
    assert.match(await admin.evaluate(() => document.activeElement?.textContent ?? ""), /חדש/, "focus returns to the + New button");
    await openMenu(admin);
    await admin.mouse.click(700, 500);
    await items(admin).first().waitFor({ state: "detached" });
    log("the menu lists the admin's four actions, works from the keyboard, and closes on Esc or a click outside");

    // ---- 2. New request goes to the existing form ----
    await openMenu(admin);
    await items(admin).filter({ hasText: "בקשה חדשה ללקוח" }).click();
    await admin.waitForURL(/\/admin\/cases\/new$/);
    log("New client request opens the existing form");

    // ---- 3. New task: pick a case, land on its Tasks tab with the title field ready ----
    await openMenu(admin);
    await items(admin).filter({ hasText: "משימה חדשה" }).click();
    const picker = admin.getByRole("dialog", { name: "לאיזה תיק להוסיף את המשימה?" });
    await picker.waitFor();
    await picker.locator("ul a").first().waitFor();
    await axe(admin, "case picker");
    const firstNumber = (await picker.locator("ul a span[dir=ltr]").first().innerText()).trim();
    await picker.getByLabel("חיפוש תיק").fill(firstNumber);
    await admin.waitForTimeout(600);
    assert.ok(
      (await picker.locator("ul a").allInnerTexts()).every((t) => t.includes(firstNumber)),
      "search narrows the cases",
    );
    await picker.locator("ul a").first().click();
    await admin.waitForURL(/\/admin\/cases\/[^/?]+\?tab=tasks$/);
    await admin.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "כותרת המשימה" || document.activeElement?.getAttribute("placeholder")?.length > 0, null, {
      timeout: 5000,
    });
    assert.equal(await admin.locator("#tab-tasks").getAttribute("aria-selected"), "true");
    log("New task asks which case, then opens its Tasks tab with the title field focused (and drops ?new= from the address)");

    // ---- 4. Client meeting: the booking form is open ----
    await openMenu(admin);
    await items(admin).filter({ hasText: "פגישה עם לקוח" }).click();
    const picker2 = admin.getByRole("dialog", { name: "לאיזה תיק לקבוע את הפגישה?" });
    await picker2.locator("ul a").first().click();
    await admin.waitForURL(/tab=meetings/);
    await admin.locator("dialog[open]").waitFor();
    log("Client meeting opens the case's Meetings tab with the booking form open");

    // ---- 5. Calendar event ----
    await admin.keyboard.press("Escape");
    await openMenu(admin);
    await items(admin).filter({ hasText: "אירוע ביומן" }).click();
    await admin.waitForURL(/\/admin\/meetings/);
    await admin.locator("dialog[open]").waitFor();
    assert.ok(!admin.url().includes("new=event"), "the one-time ?new= is dropped");
    log("Calendar event opens the new-event form on the Meetings page");

    // ---- 6. Finance sees no Quick Create; staff don't get New client request ----
    const finance = await signIn(browser, "finance@example.com");
    watch(finance);
    assert.equal(
      await finance
        .locator("header")
        .getByRole("button", { name: /יצירה מהירה/ })
        .count(),
      0,
    );
    const staff = await signIn(browser, "staff@example.com");
    watch(staff);
    await openMenu(staff);
    assert.deepEqual(
      (await items(staff).allInnerTexts()).map((s) => s.trim()),
      ["משימה חדשה", "פגישה עם לקוח", "אירוע ביומן"],
    );
    log("each role sees only its actions (finance none, staff without New client request)");

    // ---- 7. Lists as cards on a phone ----
    const phone = await signIn(browser, "admin@example.com", { width: 390, height: 844 });
    watch(phone);
    for (const pathname of ["/admin/cases", "/admin/queue?view=all", "/admin/quotes", "/admin/payments", "/admin/tasks?scope=all", "/admin/customers", "/admin/activity", "/admin/inbox"]) {
      await phone.goto(BASE + pathname);
      await settle(phone);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, `${pathname} doesn't scroll sideways`);
      const cards = phone.locator("ul[data-cards] > li");
      const n = await cards.count();
      if (n > 0) {
        assert.equal(await phone.locator("table").first().isVisible(), false, `${pathname}: the table is hidden on a phone`);
        await axe(phone, `${pathname} cards`);
      }
      log(`${pathname}: ${n} cards`);
    }
    await phone.goto(BASE + "/admin/cases");
    await settle(phone);
    await phone.screenshot({ path: OUT + "/cases-phone.png", fullPage: true });
    // The whole card opens the case.
    const card = phone.locator("ul[data-cards] > li").first();
    const href = await card.locator("a[data-card-link]").getAttribute("href");
    const box = await card.boundingBox();
    await phone.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
    await phone.waitForURL((u) => u.toString().endsWith(href));
    log("tapping anywhere on a card opens the record");
    await phone.goto(BASE + "/admin/payments");
    await settle(phone);
    await phone.screenshot({ path: OUT + "/payments-phone.png", fullPage: true });
    // Quick Create on a phone: the icon button, the menu fits the screen.
    await openMenu(phone);
    const menuBox = await items(phone).first().boundingBox();
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, "the menu fits on a phone");
    await phone.screenshot({ path: OUT + "/menu-phone.png" });
    log("Quick Create works on a phone");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE H: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE H FAILED:", e);
  process.exit(1);
});
