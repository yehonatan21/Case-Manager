// Appearance: a client picks Dark in Profile; the page turns dark at once, stays dark after a reload, and goes back to
// following the device. The same control is on a team member's account page.
//   BASE=http://localhost:3000 node e2e/theme.cjs   (server in demo mode)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "theme");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);

async function newClient(email) {
  const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
  const code = (await (await post("/api/auth/request-code", { email, purpose: "signup" })).json()).data.devCode;
  const res = await post("/api/auth/verify", { email, code, signup: { name: "Dana Levi", customerType: "private", acceptTerms: true, aiConsent: false } });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie").match(/cm_session=([^;]+)/)[1];
}
const state = (page) =>
  page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    bg: getComputedStyle(document.body).backgroundColor,
    bar: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
  }));
const LIGHT = "rgb(249, 246, 242)";
const DARK = "rgb(12, 18, 26)";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  try {
    // The device is in light mode throughout, so a dark page can only come from the person's choice.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL", colorScheme: "light" });
    await ctx.addCookies([{ name: "cm_session", value: await newClient(`theme-e2e-${Date.now()}@example.com`), url: BASE }]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/portal/profile");
    const group = page.getByRole("radiogroup", { name: "מראה" });
    await group.waitFor();
    assert.equal(await group.getByRole("radio", { name: "לפי המכשיר" }).getAttribute("aria-checked"), "true");
    assert.deepEqual({ ...(await state(page)), bar: undefined }, { theme: null, bg: LIGHT, bar: undefined });

    await group.getByRole("radio", { name: "כהה" }).click();
    let s = await state(page);
    assert.equal(s.theme, "dark");
    assert.equal(s.bg, DARK, "the page is dark at once");
    assert.ok(s.bar.every((c) => c === "#0c121a"), "the browser bar follows");
    await page.waitForTimeout(400); // let the colour transition finish
    await page.screenshot({ path: OUT + "/dark.png" });
    await page.reload();
    await group.waitFor();
    s = await state(page);
    assert.equal(s.theme, "dark", "remembered after a reload");
    assert.equal(s.bg, DARK);
    assert.ok(s.bar.every((c) => c === "#0c121a"));
    assert.equal(await group.getByRole("radio", { name: "כהה" }).getAttribute("aria-checked"), "true");
    log("Dark applies at once and is remembered");

    // Light wins over a device in dark mode.
    await group.getByRole("radio", { name: "בהיר" }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal((await state(page)).bg, LIGHT, "Light holds on a dark device");
    await group.getByRole("radio", { name: "לפי המכשיר" }).click();
    s = await state(page);
    assert.equal(s.theme, null);
    assert.equal(s.bg, DARK, "back to following the device (dark)");
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal((await state(page)).bg, LIGHT);
    log("Light overrides a dark device; Device follows it again");
    await ctx.close();

    // The team's account page has the same control.
    const staff = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "he-IL", colorScheme: "light" });
    const sp = await staff.newPage();
    sp.on("pageerror", (e) => errors.push(e.message));
    await sp.goto(`${BASE}/login?as=${encodeURIComponent("admin@example.com")}`);
    const code = (await sp.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText()).match(/\d{6}/)[0];
    await sp.fill('input[autocomplete="one-time-code"]', code);
    await sp.click("button[type=submit]");
    await sp.waitForURL((u) => new URL(u).pathname.startsWith("/admin"));
    await sp.goto(BASE + "/admin/account");
    await sp.getByRole("radiogroup", { name: "מראה" }).getByRole("radio", { name: "כהה" }).click();
    assert.equal((await state(sp)).bg, DARK);
    await sp.screenshot({ path: OUT + "/staff-dark.png" });
    await staff.close();
    log("the team's account page has it too");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nTHEME: all passed");
  } catch (e) {
    console.error("\nTHEME FAILED:", e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
