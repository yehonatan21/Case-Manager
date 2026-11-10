// Release K in the browser: the attention center on the dashboard ("Mine" by default, "Everyone's" on request, in
// the address; each item opens where it's handled), axe on both views (WCAG 2.2 AA), and the same in English.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-k.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-k");
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
      (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } })).violations.map(
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
const section = (p) => p.locator("section", { has: p.getByRole("heading", { name: "דורש טיפול עכשיו" }) });
const itemLinks = (p) => section(p).locator("li a");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    // ---- 1. A case manager: Mine by default, Everyone's on request ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    await manager.goto(BASE + "/admin");
    await settle(manager);
    const toggle = section(manager).getByRole("navigation");
    assert.equal(await toggle.getByRole("link", { name: "שלי" }).getAttribute("aria-current"), "page");
    const mine = await itemLinks(manager).count();
    await axe(manager, "attention: mine");
    await manager.screenshot({ path: OUT + "/attention-mine.png", fullPage: true });
    await toggle.getByRole("link", { name: "של כולם" }).click();
    await manager.waitForURL(/attention=all/);
    await settle(manager);
    assert.equal(await toggle.getByRole("link", { name: "של כולם" }).getAttribute("aria-current"), "page");
    const all = await itemLinks(manager).count();
    assert.ok(all >= mine, `everyone's (${all}) includes mine (${mine})`);
    await axe(manager, "attention: everyone's");
    log(`the attention center shows mine by default (${mine}) and everyone's on request (${all})`);

    // ---- 2. Each item opens where it's handled ----
    if (all > 0) {
      const href = await itemLinks(manager).first().getAttribute("href");
      assert.match(href, /^\/admin\/(cases\/[0-9a-f-]{36}(\?tab=\w+)?|payments)/);
      await itemLinks(manager).first().click();
      await manager.waitForURL((u) => u.toString().endsWith(href));
      log(`an item opens where it's handled: ${href.replace(/[0-9a-f-]{36}/, "…")}`);
    }

    // ---- 3. Finance: only what they handle ----
    const finance = await signIn(browser, "finance@example.com");
    watch(finance);
    await finance.goto(BASE + "/admin");
    await settle(finance);
    await section(finance).waitFor();
    await axe(finance, "attention: finance");
    log("finance's dashboard has the attention center too");

    // ---- 4. English ----
    await manager.context().addCookies([{ name: "cm_locale", value: "en", url: BASE }]);
    await manager.goto(BASE + "/admin");
    await settle(manager);
    await manager.getByRole("heading", { name: "Needs attention now" }).waitFor();
    await manager.getByRole("link", { name: "Mine" }).waitFor();
    log("in English too");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE K: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE K FAILED:", e);
  process.exit(1);
});
