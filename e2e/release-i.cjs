// Release I in the browser: Settings loads only the open tab (the others aren't on the page until opened), each
// tab opens from the address, Back/Forward and the keyboard; saving still works; and a page the menu doesn't show
// a role (Meetings for finance) turns them away. axe runs on every tab.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-i.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-i");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(800);

async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "he", timezoneId: "Asia/Jerusalem" });
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
const panel = (p) => p.locator("[role=tabpanel]:not([aria-busy])");
const selected = (p) => p.locator("[role=tab][aria-selected=true]").getAttribute("id");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);

    // ---- 1. Only the open tab is on the page ----
    await admin.goto(BASE + "/admin/settings");
    await settle(admin);
    assert.equal(await panel(admin).getAttribute("id"), "panel-general");
    assert.equal(await admin.locator("[role=tabpanel]").count(), 1, "one panel on the page");
    assert.equal(await admin.locator("table").count(), 0, "the Users and Price list tables aren't loaded");
    assert.equal(await admin.getByText("staff@example.com").count(), 0, "the team list isn't loaded");
    log("Settings opens with General only; the other tabs' data isn't on the page");

    // ---- 2. Opening a tab loads it; the address, Back/Forward and reload follow ----
    await admin.locator("#tab-users").click();
    await admin.waitForURL(/tab=users/);
    await panel(admin).and(admin.locator("#panel-users")).waitFor();
    await admin.getByText("staff@example.com").first().waitFor();
    assert.equal(await admin.locator("#panel-general").count(), 0, "General is gone");
    await admin.locator("#tab-priceList").click();
    await admin.locator("#panel-priceList:not([aria-busy])").waitFor();
    await admin.goBack();
    await admin.locator("#panel-users:not([aria-busy])").waitFor();
    assert.equal(await selected(admin), "tab-users");
    await admin.goForward();
    await admin.locator("#panel-priceList:not([aria-busy])").waitFor();
    await admin.reload();
    await settle(admin);
    assert.equal(await selected(admin), "tab-priceList");
    log("each tab loads when opened, and the address, Back, Forward and reload keep to it");

    // ---- 3. The keyboard moves between tabs (in Hebrew, the left arrow is "next") ----
    await admin.locator("#tab-priceList").focus();
    await admin.keyboard.press("ArrowLeft");
    await admin.waitForURL(/tab=integrations/);
    await admin.locator("#panel-integrations:not([aria-busy])").waitFor();
    assert.equal(await admin.evaluate(() => document.activeElement?.id), "tab-integrations");
    log("the arrow keys open the next tab and keep focus on the tab bar");

    // ---- 4. Every tab: its content, and axe ----
    const expect = {
      general: "שמירה",
      users: "staff@example.com",
      templates: "תבנית חדשה",
      serviceTypes: null,
      automation: null,
      priceList: null,
      integrations: "Google",
      health: null,
    };
    for (const [tab, text] of Object.entries(expect)) {
      await admin.goto(`${BASE}/admin/settings?tab=${tab}`);
      await settle(admin);
      assert.equal(await panel(admin).getAttribute("id"), `panel-${tab}`);
      if (text) await panel(admin).getByText(text).first().waitFor();
      await axe(admin, `settings → ${tab}`);
    }
    await admin.goto(`${BASE}/admin/settings?tab=bogus`);
    await settle(admin);
    assert.equal(await panel(admin).getAttribute("id"), "panel-general");
    log("every tab opens from its address and passes axe; an unknown tab opens General");

    // ---- 5. Saving still works (and the saved value comes back after a reload) ----
    const name = admin.getByLabel("שם העסק");
    const before = await name.inputValue();
    await name.fill(before + " (בדיקה)");
    await panel(admin).getByRole("button", { name: "שמירה" }).click();
    await admin.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    await admin.reload();
    await settle(admin);
    assert.equal(await admin.getByLabel("שם העסק").inputValue(), before + " (בדיקה)");
    await admin.getByLabel("שם העסק").fill(before);
    await panel(admin).getByRole("button", { name: "שמירה" }).click();
    await admin.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    await admin.screenshot({ path: OUT + "/general.png", fullPage: true });
    log("saving General still works");

    // ---- 6. The server and the menu agree: finance has no Meetings ----
    const finance = await signIn(browser, "finance@example.com");
    watch(finance);
    assert.equal(await finance.locator("aside").getByRole("link", { name: "פגישות" }).count(), 0);
    await finance.goto(BASE + "/admin/meetings");
    await finance.waitForURL(BASE + "/admin");
    log("finance doesn't see Meetings in the menu, and opening it sends them to the dashboard");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE I: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE I FAILED:", e);
  process.exit(1);
});
