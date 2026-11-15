// Release N in the browser: on a case, the AI summary strip above the work area (generate, then what the client
// wants and the suggested next step), and "Draft a reply with AI" in the message composer: the draft lands in the
// box with a review notice, is sent by a person, and is marked as drafted with AI. axe on the result.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-n.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-n");
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
  // Buttons fade between colours when they change state; check once that has finished.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x instanceof CSSTransition).map((x) => x.finished.catch(() => {}))));
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () =>
    (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`),
  );
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  try {
    // A client writes to the team, so there is something to answer.
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    const href = await client.locator('a[href^="/portal/cases/"]').first().getAttribute("href");
    const caseId = href.match(/cases\/([0-9a-f-]{36})/)[1];
    const question = `מתי המסמכים יהיו מוכנים? ${Date.now()}`;
    const sent = await client.evaluate(async ([id, body]) => (await fetch(`/api/cases/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, kind: "thread" }) })).status, [caseId, question]);
    assert.equal(sent, 200);
    await client.context().close();

    const admin = await signIn(browser, "admin@example.com");
    admin.on("pageerror", (e) => errors.push(e.message));
    await admin.goto(`${BASE}/admin/cases/${caseId}?tab=messages`);
    await settle(admin);

    // ---- 1. The summary strip ----
    const brief = admin.locator("[data-ai-brief]");
    await brief.getByRole("heading", { name: /סיכום AI/ }).waitFor();
    const make = brief.getByRole("button", { name: /יצירת סיכום|רענון/ });
    if (await make.count()) {
      await make.click();
      await brief.getByText("מה הלקוח רוצה").waitFor({ timeout: 30000 });
    }
    assert.ok((await brief.locator("dd").first().innerText()).trim().length > 5, "what the client wants is shown");
    assert.ok((await brief.locator("dd").nth(1).innerText()).trim().length > 5, "the suggested next step is shown");
    log("the summary strip shows what the client wants and the suggested next step");

    // ---- 2. A reply drafted with AI ----
    const composer = admin.locator("#composer-thread");
    await composer.fill("עד יום חמישי.");
    await admin.getByRole("button", { name: "טיוטת תשובה ב-AI" }).click();
    await admin.getByText("יש לעבור על הטיוטה לפני השליחה").waitFor({ timeout: 30000 });
    const draft = await composer.inputValue();
    assert.ok(draft.includes("עד יום חמישי."), "the team's notes are in the draft");
    assert.ok(draft.includes("מתי המסמכים יהיו מוכנים?"), "it answers the client's last message");
    await admin.screenshot({ path: OUT + "/draft.png" });
    await axe(admin, "case with a drafted reply");
    // Nothing is sent until a person sends it.
    await admin.getByRole("button", { name: "שליחה", exact: true }).click();
    await admin.getByText(/נוסח בעזרת AI ואושר על ידי/).last().waitFor({ timeout: 15000 });
    assert.equal(await composer.inputValue(), "");
    log("the draft lands in the composer, a person sends it, and it's marked as drafted with AI");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nRELEASE N: all passed");
  } catch (e) {
    console.error("\nRELEASE N FAILED:", e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
