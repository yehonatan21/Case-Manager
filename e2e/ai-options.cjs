// Service types and AI consent in the browser: an admin adds a service type in Settings and it's offered when
// opening a request; a client the team opened an account for is asked once on the portal whether the team may
// use AI, the answer sticks, and it can be changed on the profile. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/ai-options.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "ai-options");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

async function signIn(browser, email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "he" });
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
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  try {
    // ---- 1. Admin adds a service type ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings?tab=serviceTypes");
    await settle(admin);
    const he = `גירושין ${stamp}`;
    const en = `Divorce ${stamp}`;
    await admin.getByLabel("שם בעברית").last().fill(he);
    await admin.getByLabel("שם באנגלית").last().fill(en);
    await admin.click("button:has-text('הוספת סוג')");
    await admin.locator("[role=status]", { hasText: "סוג השירות נוסף" }).first().waitFor();
    await settle(admin);
    await admin.getByText(he).first().waitFor();
    await axe(admin, "settings → service types");
    await admin.screenshot({ path: OUT + "/service-types.png", fullPage: true });
    // Offered when opening a request for a client.
    await admin.goto(BASE + "/admin/cases/new");
    await settle(admin);
    const options = await admin.locator("select option").allInnerTexts();
    assert.ok(options.includes(he), "the new type is offered");
    log("admin added a service type; it's offered for new requests");

    // ---- 2. A client the team opened an account for is asked about AI ----
    const email = `ai-consent-${stamp}@example.com`;
    const r = await admin.request.fetch(BASE + "/api/admin/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { customer: { email, name: "לקוחה חדשה", customerType: "private", locale: "he" }, title: `בקשה ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" },
    });
    assert.equal(r.status(), 200);
    const client = await signIn(browser, email, { width: 390, height: 844 });
    watch(client);
    await client.goto(BASE + "/portal");
    await settle(client);
    const prompt = client.locator("section[aria-labelledby=ai-consent-title]");
    await prompt.waitFor();
    await axe(client, "portal with the AI consent prompt");
    await client.screenshot({ path: OUT + "/prompt.png", fullPage: true });
    await prompt.locator("button:has-text('כן, לאפשר')").click();
    await client.locator("[role=status]", { hasText: "תודה!" }).first().waitFor();
    await settle(client);
    await client.reload();
    await settle(client);
    assert.equal(await prompt.count(), 0, "asked only once");
    // The profile shows the choice and can withdraw it.
    await client.goto(BASE + "/portal/profile");
    await settle(client);
    const box = client.getByLabel("לאפשר לצוות להיעזר בכלי AI בפניות שלי");
    assert.equal(await box.isChecked(), true);
    await box.uncheck();
    await client.click("button:has-text('שמירה')");
    await client.locator("[role=status]", { hasText: "הפרופיל עודכן" }).first().waitFor();
    await settle(client);
    await client.goto(BASE + "/portal");
    await settle(client);
    assert.equal(await prompt.count(), 0, "a 'no' isn't asked again");
    log("the client was asked once, allowed AI, then withdrew it on the profile");

    // The demo client registered with consent: never asked.
    const demo = await signIn(browser, "client@example.com");
    await demo.goto(BASE + "/portal");
    await settle(demo);
    assert.equal(await demo.locator("section[aria-labelledby=ai-consent-title]").count(), 0);

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nAI OPTIONS: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("AI OPTIONS FAILED:", e);
  process.exit(1);
});
