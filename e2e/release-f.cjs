// Release F in the browser: the grouped staff menu (groups by role, "My Work"), collapsing it (remembered after a
// reload, names on hover and keyboard focus, the page moves with it), the side it sits on in Hebrew and English,
// the mobile drawer (right side in Hebrew, page doesn't scroll behind it, Esc and choosing an item close it), and
// opening a case from the cases table with the keyboard. axe runs in each state.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-f.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-f");
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
  const run = () => page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  let v = await run();
  if (v.length === 1 && v[0].startsWith("document-title")) {
    await page.waitForTimeout(1500);
    v = await run();
  }
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    // ---- 1. The grouped menu ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/cases");
    await settle(admin);
    const side = admin.locator("aside");
    for (const g of ["סביבת עבודה", "תפעול", "ניהול העסק", "מערכת"]) await side.getByText(g, { exact: true }).waitFor();
    const names = await side.locator("nav a").allInnerTexts();
    assert.deepEqual(names.map((s) => s.replace(/\d+$/, "").trim()).slice(0, 4), ["לוח בקרה", "לטיפול שלי", "בקשות נכנסות", "הצעות מחיר"]);
    assert.equal(await side.getByRole("link", { name: "תיקים" }).getAttribute("aria-current"), "page");
    // Hebrew: the sidebar is on the right.
    let box = await side.boundingBox();
    assert.ok(box.x > 1440 / 2, "the sidebar is on the right in Hebrew");
    assert.equal(Math.round(box.width), 256);
    await axe(admin, "grouped menu");
    await admin.screenshot({ path: OUT + "/expanded.png" });
    log("the menu is grouped, in order, with the current page marked");

    // ---- 2. Collapsing: icons, names on hover/focus, remembered ----
    await side.getByRole("button", { name: "כיווץ התפריט" }).click();
    await admin.waitForFunction(() => Math.round(document.querySelector("aside").getBoundingClientRect().width) === 72);
    // The page moved with it (nothing under the sidebar).
    const mainBox = await admin.locator("main").boundingBox();
    assert.ok(mainBox.x + mainBox.width <= 1440 - 72 + 1, "the page isn't under the sidebar");
    // Links keep their names for screen readers; hovering shows the name.
    assert.equal(await side.getByRole("link", { name: "תיקים" }).count(), 1);
    await side.getByRole("link", { name: "הצעות מחיר" }).hover();
    await admin.locator("div.fixed", { hasText: "הצעות מחיר" }).waitFor();
    await side.getByRole("link", { name: "תשלומים" }).focus();
    await admin.locator("div.fixed", { hasText: "תשלומים" }).waitFor();
    await axe(admin, "collapsed menu");
    await admin.screenshot({ path: OUT + "/collapsed.png" });
    await admin.reload();
    await settle(admin);
    box = await admin.locator("aside").boundingBox();
    assert.equal(Math.round(box.width), 72, "still collapsed after a reload");
    await admin.locator("aside").getByRole("button", { name: "הרחבת התפריט" }).click();
    await admin.waitForFunction(() => Math.round(document.querySelector("aside").getBoundingClientRect().width) === 256);
    log("the menu collapses to icons (names on hover and focus), and stays that way after a reload");

    // ---- 3. English: the sidebar is on the left ----
    await admin.context().addCookies([{ name: "cm_locale", value: "en", url: BASE }]);
    await admin.reload();
    await settle(admin);
    assert.equal(await admin.locator("html").getAttribute("lang"), "en");
    {
      box = await admin.locator("aside").boundingBox();
      assert.ok(box.x < 10, "the sidebar is on the left in English");
      await admin.locator("aside").getByText("Workspace", { exact: true }).waitFor();
      await admin.locator("aside").getByRole("link", { name: "My Work" }).waitFor();
      await axe(admin, "menu in English");
      log("in English the menu is on the left, with English group names");
    }
    await admin.context().addCookies([{ name: "cm_locale", value: "he", url: BASE }]);

    // ---- 4. Each role sees only its groups ----
    const staff = await signIn(browser, "staff@example.com");
    watch(staff);
    const groups = await staff.locator("aside nav p").allInnerTexts();
    assert.deepEqual(groups, ["סביבת עבודה", "תפעול"]);
    assert.equal(await staff.locator("aside").getByRole("link", { name: "הגדרות" }).count(), 0);
    log("a staff member sees only the Workspace and Operations groups");

    // ---- 5. Opening a case with the keyboard ----
    await admin.goto(BASE + "/admin/cases");
    await settle(admin);
    const firstLink = admin.locator("tbody tr a").first();
    const href = await firstLink.getAttribute("href");
    await firstLink.focus();
    await admin.keyboard.press("Enter");
    await admin.waitForURL((u) => u.toString().endsWith(href));
    log("a case opens from the table with the keyboard");

    // ---- 6. The mobile drawer ----
    const phone = await signIn(browser, "manager@example.com", { width: 390, height: 844 });
    watch(phone);
    await phone.goto(BASE + "/admin");
    await settle(phone);
    await phone.getByRole("button", { name: "תפריט" }).click();
    const drawer = phone.locator("dialog#admin-mobile-menu");
    await drawer.waitFor();
    const db = await drawer.boundingBox();
    assert.ok(db.x + db.width >= 389, "the drawer opens from the right in Hebrew");
    assert.equal(await phone.evaluate(() => document.documentElement.style.overflow), "hidden");
    await axe(phone, "mobile menu");
    await phone.screenshot({ path: OUT + "/mobile-menu.png" });
    await phone.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await phone.evaluate(() => document.documentElement.style.overflow), "");
    await phone.getByRole("button", { name: "תפריט" }).click();
    await drawer.getByRole("link", { name: "לטיפול שלי" }).click();
    await phone.waitForURL(/\/admin\/queue/);
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    log("on a phone the drawer opens from the right, stops the page scrolling, and closes with Esc or a choice");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE F: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE F FAILED:", e);
  process.exit(1);
});
