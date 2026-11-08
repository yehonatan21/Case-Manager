// Email and calendar events in the browser, against a stand-in for Resend's API (started by this script on :4018):
// an admin connects an email service in Settings → Integrations (a wrong key is refused; a test email arrives),
// sign-in codes then go out through it; a team member adds an event on the Meetings calendar, edits it and
// deletes it. axe runs on each new screen.
// Requires the app in demo mode with RESEND_API_URL=http://localhost:4018:
//   BASE=http://localhost:3000 node e2e/email-calendar.cjs
const http = require("node:http");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const PORT = Number(process.env.FAKE_RESEND_PORT || 4018);
const OUT = path.join(__dirname, "screenshots", "email-calendar");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

// ---------- Fake Resend ----------
const KEY = "re_e2e_key_123456";
const sent = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const json = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url !== "/emails" || req.method !== "POST") return json(404, { message: "not found" });
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { message: "API key is invalid" });
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    sent.push(body);
    json(200, { id: `email_${sent.length}` });
  });
});
async function waitFor(pred, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function signIn(browser, email, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "he", timezoneId: "Asia/Jerusalem" });
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.accept());
  await p.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  await settle(p);
  const code = (await p.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await p.fill('input[autocomplete="one-time-code"]', code);
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
  return p;
}
async function axe(page, label) {
  // Next.js streams the <title> in just after the page loads; check once it's there, as a visitor would.
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const run = () => page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  let v = await run();
  // A page refreshing after a save briefly has no <title> while Next.js streams the new one in: check again once.
  if (v.length === 1 && v[0].startsWith("document-title")) {
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
    v = await run();
  }
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  await new Promise((r) => fake.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  let admin;
  try {
    // ---- 1. The admin connects an email service ----
    admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings?tab=integrations");
    await settle(admin);
    const card = admin.locator("div.rounded-xl", { has: admin.getByRole("heading", { name: "דוא״ל", exact: true }) }).first();
    await card.getByText("לא נשלח", { exact: true }).waitFor();
    await card.locator("button:has-text('חיבור דוא״ל')").click();
    await card.getByLabel("שירות").selectOption("resend");
    await card.getByLabel(/^מפתח API/).fill("re_wrong_key_0000");
    await card.getByLabel(/^כתובת השולח/).fill("updates@example.com");
    await card.getByLabel("שם השולח").fill("המשרד");
    await axe(admin, "email connect form");
    await card.locator("button:has-text('בדיקה וחיבור')").click();
    await admin.locator("[role=alert]", { hasText: "שירות הדוא״ל לא שלח את הודעת הבדיקה" }).first().waitFor();
    await card.getByLabel(/^מפתח API/).fill(KEY);
    await card.locator("button:has-text('בדיקה וחיבור')").click();
    await admin.locator("[role=status]", { hasText: "נשלחה אליכם הודעת בדיקה" }).first().waitFor();
    assert.deepEqual(sent[0].to, ["admin@example.com"]);
    assert.equal(sent[0].from, "המשרד <updates@example.com>");
    await settle(admin);
    await card.getByText("מחובר", { exact: true }).waitFor();
    assert.equal(await admin.locator(`text=${KEY}`).count(), 0, "the key is never shown");
    await card.locator("button:has-text('שליחת הודעת בדיקה')").click();
    await admin.locator("[role=status]", { hasText: "נשלחה הודעת בדיקה אל admin@example.com" }).first().waitFor();
    assert.equal(sent.length, 2);
    await axe(admin, "email connected");
    await admin.screenshot({ path: OUT + "/email.png", fullPage: true });
    log("the admin connected Resend; a wrong key was refused and the test email arrived");

    // ---- 2. Sign-in codes now go out through it ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    const otp = await waitFor(() => sent.find((m) => m.to[0] === "manager@example.com"), "the sign-in code email");
    assert.match(otp.subject, /\d{6}/);
    log("the sign-in code was emailed through the connected service");

    // ---- 3. A team member's own event on the calendar ----
    await manager.goto(BASE + "/admin/meetings?view=week");
    await settle(manager);
    const cal = manager.locator("#calendar");
    await cal.locator("button:has-text('אירוע חדש')").click();
    const dlg = manager.getByRole("dialog");
    await dlg.getByLabel(/^כותרת/).fill("פגישת צוות שבועית");
    await dlg.getByLabel(/^מתחיל/).fill("10:00");
    await dlg.getByLabel(/^מסתיים/).fill("11:00");
    await dlg.getByLabel("הערות").fill("להביא את רשימת התיקים");
    await dlg.getByText("חברו את יומן Google כדי שהאירוע יתווסף גם אליו.").waitFor();
    await axe(manager, "new event dialog");
    await dlg.locator("button:has-text('הוספת האירוע')").click();
    await manager.locator("[role=status]", { hasText: "האירוע נוסף." }).first().waitFor();
    await settle(manager);
    const chip = cal.getByRole("button", { name: /פגישת צוות שבועית/ });
    await chip.waitFor();
    assert.match(await chip.innerText(), /10:00/);
    await axe(manager, "calendar with an event");
    await manager.screenshot({ path: OUT + "/event.png", fullPage: true });

    await chip.click();
    await dlg.getByLabel(/^כותרת/).fill("פגישת צוות (הוזזה)");
    await dlg.getByLabel(/^מתחיל/).fill("12:00");
    await dlg.getByLabel(/^מסתיים/).fill("12:30");
    await dlg.locator("button:has-text('שמירה')").click();
    await manager.locator("[role=status]", { hasText: "האירוע נשמר." }).first().waitFor();
    await settle(manager);
    const moved = cal.getByRole("button", { name: /פגישת צוות \(הוזזה\)/ });
    assert.match(await moved.innerText(), /12:00/);
    await moved.click();
    await dlg.locator("button:has-text('מחיקה')").click();
    await manager.locator("[role=status]", { hasText: "האירוע נמחק." }).first().waitFor();
    await settle(manager);
    assert.equal(await cal.getByRole("button", { name: /פגישת צוות/ }).count(), 0);
    log("the team member added an event, moved it and deleted it");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nEMAIL & CALENDAR: all passed");
  } finally {
    // Leave the demo sending as before for the other scripts.
    if (admin) await admin.request.fetch(BASE + "/api/admin/email", { method: "DELETE" }).catch(() => {});
    await browser.close();
    fake.close();
  }
})().catch((e) => {
  console.error("EMAIL & CALENDAR FAILED:", e);
  process.exit(1);
});
