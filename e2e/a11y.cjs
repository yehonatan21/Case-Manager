// Accessibility regression check (WCAG 2.2 AA / IS 5568): axe-core on the main pages and states
// (Hebrew & English, desktop & mobile, public, customer and staff, open drawer / dialog / notifications, the
// collapsed menu, Quick Create, the search, every Settings tab, the lists as phone cards), plus checks axe can't
// do: drawer focus and Esc, sign-in errors, focus after errors, focus never hidden under the sticky header
// (2.4.11), 320px reflow.
// Fails on any axe violation. Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/a11y.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(900);
const problems = [];
let scanned = 0;

async function axe(page, label) {
  // Next.js streams the <title> in just after the page loads; check once it's there, as a visitor would.
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: "tag", values: tags } })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 3) })), TAGS);
  scanned++;
  for (const v of r) problems.push(`${label}: ${v.id} (${v.impact}) at ${v.nodes.join(", ")}`);
}
async function visit(ctx, url, label, after) {
  const p = await ctx.newPage();
  await p.goto(BASE + url);
  await settle(p);
  if (after) await after(p);
  await axe(p, `${label} ${url}`);
  return p;
}
async function signIn(browser, email) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  await settle(p);
  const code = (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await p.fill('input[autocomplete="one-time-code"]', code);
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

(async () => {
  const browser = await chromium.launch();
  const client = await signIn(browser, "biz@example.com"); // a customer with cases and a quote
  const manager = await signIn(browser, "manager@example.com");
  const admin = await signIn(browser, "admin@example.com");
  try {
    for (const [name, viewport, locale] of [
      ["he", { width: 1280, height: 900 }, "he"],
      ["he-mobile", { width: 390, height: 844 }, "he"],
      ["en", { width: 1280, height: 900 }, "en"],
    ]) {
      const cookie = { name: "cm_locale", value: locale, url: BASE };
      // Public
      const pub = await browser.newContext({ viewport, locale });
      await pub.addCookies([cookie]);
      for (const u of ["/", "/login", "/register", "/intake/manual", "/accessibility", "/privacy", "/terms", "/no-such-page"]) await (await visit(pub, u, name)).close();
      // Customer
      const c = await browser.newContext({ viewport, locale, storageState: client });
      await c.addCookies([cookie]);
      const list = await visit(c, "/portal/cases", name);
      const caseUrl = await list.locator("a[href^='/portal/cases/']").first().getAttribute("href");
      for (const u of ["/portal", "/portal/notifications", "/portal/profile", caseUrl, `${caseUrl}?tab=quote`, `${caseUrl}?tab=documents`]) await (await visit(c, u, name)).close();
      // Notifications panel open
      await (await visit(c, "/portal", `${name} (bell open)`, async (p) => {
        await p.locator("button[aria-controls='notifications-panel']").first().click();
        await p.locator("#notifications-panel").waitFor();
      })).close();
      // Staff (case manager)
      const s = await browser.newContext({ viewport, locale, storageState: manager });
      await s.addCookies([cookie]);
      const cases = await visit(s, "/admin/cases?status=all", name);
      const adminCase = (await cases.locator("a[href^='/admin/cases/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).find((h) => /[0-9a-f-]{36}/.test(h));
      for (const u of ["/admin", "/admin?attention=all", "/admin/inbox", "/admin/queue", "/admin/cases/new", "/admin/quotes", "/admin/tasks?scope=all", "/admin/conversations", "/admin/meetings", "/admin/customers", "/admin/reports", "/admin/notifications", "/admin/account", adminCase, `${adminCase}?tab=quotes`, `${adminCase}?tab=tasks`, `${adminCase}?tab=documents`]) await (await visit(s, u, name)).close();
      // Quick Create open, and the search with results
      await (await visit(s, "/admin", `${name} (quick create open)`, async (p) => {
        await p.locator("header [aria-controls]").filter({ hasText: /חדש|New/ }).first().click();
        await p.locator("header [data-qc-item]").first().waitFor();
      })).close();
      await (await visit(s, "/admin", `${name} (search open)`, async (p) => {
        await p.locator("header button[aria-keyshortcuts]").click();
        await p.getByRole("combobox").fill("CASE");
        await p.getByRole("option").first().waitFor();
      })).close();
      // Admin-only pages: payments, the activity log and every Settings tab
      const a = await browser.newContext({ viewport, locale, storageState: admin });
      await a.addCookies([cookie]);
      for (const u of ["/admin/payments", "/admin/activity", ...["general", "users", "templates", "serviceTypes", "automation", "priceList", "integrations", "health"].map((t) => `/admin/settings?tab=${t}`)]) await (await visit(a, u, name)).close();
      if (name !== "he-mobile") {
        // The collapsed menu (icons only, names on hover)
        await a.addCookies([{ name: "cm_nav_collapsed", value: "1", url: BASE }]);
        await (await visit(a, "/admin/cases", `${name} (menu collapsed)`, async (p) => {
          await p.locator("aside nav a").first().hover();
        })).close();
        await a.addCookies([{ name: "cm_nav_collapsed", value: "0", url: BASE }]);
      }
      await a.close();
      if (name === "he-mobile") {
        // Drawer open
        await (await visit(s, "/admin", `${name} (drawer open)`, async (p) => {
          await p.locator("button[aria-controls='admin-mobile-menu']").click();
          await p.locator("#admin-mobile-menu[open]").waitFor();
        })).close();
      }
      await pub.close();
      await c.close();
      await s.close();
    }
    log(`axe: ${scanned} page states scanned`);

    // ---- Keyboard and behaviour checks ----
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he", storageState: manager });
    const mp = await m.newPage();
    await mp.goto(BASE + "/admin");
    await settle(mp);
    const menu = mp.locator("button[aria-controls='admin-mobile-menu']");
    await menu.focus();
    await mp.keyboard.press("Enter");
    await mp.locator("#admin-mobile-menu[open]").waitFor();
    assert.ok(await mp.evaluate(() => document.getElementById("admin-mobile-menu").contains(document.activeElement)), "focus moves into the drawer");
    for (let i = 0; i < 6; i++) await mp.keyboard.press("Tab");
    assert.ok(await mp.evaluate(() => document.getElementById("admin-mobile-menu").contains(document.activeElement) || document.activeElement === document.body), "Tab stays in the drawer");
    await mp.keyboard.press("Escape");
    await mp.waitForTimeout(300);
    assert.equal(await mp.locator("#admin-mobile-menu[open]").count(), 0, "Esc closes the drawer");
    assert.equal(await menu.evaluate((b) => b === document.activeElement), true, "focus returns to the menu button");
    log("drawer: focus in, Tab kept inside, Esc closes, focus returns");

    // ---- 2.4.11 Focus not obscured: tabbing through a long page, no focused control hides under the header ----
    for (const [vp, url] of [[{ width: 1280, height: 700 }, "/admin/settings?tab=general"], [{ width: 390, height: 700 }, "/admin/cases?status=all"]]) {
      const fx = await browser.newContext({ viewport: vp, locale: "he", storageState: admin });
      const fp = await fx.newPage();
      await fp.goto(BASE + url);
      await settle(fp);
      let checked = 0;
      for (let i = 0; i < 60; i++) {
        await fp.keyboard.press("Tab");
        const r = await fp.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body || el.closest("dialog")) return null;
          const rc = el.getBoundingClientRect();
          if (!rc.width || !rc.height) return null;
          // What is drawn at the control's centre: the control itself (or its own content) unless something covers it.
          const x = Math.min(Math.max(rc.left + rc.width / 2, 0), innerWidth - 1);
          const y = Math.min(Math.max(rc.top + rc.height / 2, 0), innerHeight - 1);
          const top = document.elementFromPoint(x, y);
          const visible = rc.bottom > 0 && rc.top < innerHeight && !!top && (top === el || el.contains(top) || top.contains(el));
          return { visible, what: el.outerHTML.slice(0, 90), cover: top?.outerHTML.slice(0, 60) ?? "" };
        });
        if (!r) continue;
        checked++;
        assert.ok(r.visible, `focused control hidden: ${r.what} — covered by ${r.cover}`);
      }
      assert.ok(checked > 10, `tabbed through ${url}`);
      await fx.close();
    }
    log("focus never ends up hidden under the sticky header (2.4.11), on desktop and phone");

    const pub = await browser.newContext({ locale: "he" });
    const lp = await pub.newPage();
    await lp.goto(BASE + "/login");
    await settle(lp);
    await lp.fill("input[type=email]", "not-an-email");
    assert.equal(await lp.locator("button[type=submit]").isDisabled(), false, "submit isn't silently disabled");
    await lp.keyboard.press("Enter");
    await lp.locator("input[type=email][aria-invalid=true]").waitFor();
    assert.match(await lp.locator("[role=alert]").first().innerText(), /דוא״ל/);
    assert.equal(await lp.evaluate(() => document.activeElement.type), "email", "focus on the invalid field");
    log("sign-in: invalid email explained and focused");

    await lp.fill("input[type=email]", "staff@example.com");
    await lp.click("button[type=submit]");
    await lp.locator('input[autocomplete="one-time-code"]').waitFor();
    await lp.fill('input[autocomplete="one-time-code"]', "000000");
    await lp.click("button[type=submit]");
    await lp.locator('input[autocomplete="one-time-code"][aria-invalid=true]').waitFor();
    assert.equal(await lp.evaluate(() => document.activeElement.getAttribute("autocomplete")), "one-time-code", "focus back on the code field");
    log("sign-in: wrong code marked, focus kept on the field");

    const narrow = await browser.newContext({ viewport: { width: 320, height: 640 }, locale: "he" });
    const np = await narrow.newPage();
    for (const u of ["/", "/login", "/register", "/accessibility"]) {
      await np.goto(BASE + u);
      await np.waitForTimeout(400);
      assert.equal(await np.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `no horizontal scroll at 320px on ${u}`);
    }
    log("320px: no horizontal scroll");

    if (problems.length) throw new Error(`${problems.length} accessibility violation(s):\n  ${problems.join("\n  ")}`);
    console.log("\nA11Y: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("A11Y FAILED:", e);
  process.exit(1);
});
