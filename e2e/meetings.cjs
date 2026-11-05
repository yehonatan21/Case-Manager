// Meetings in the browser: a team member sets their hours on the Meetings page; a client books a video meeting
// in a free slot from their case (mobile) and downloads the .ics; the team member sees it, moves it to another
// time; the client cancels it. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/meetings.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "meetings");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

async function signIn(browser, email, viewport = { width: 1280, height: 900 }) {
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
  // Next.js streams the <title> in just after the page loads; check once it's there, as a visitor would.
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
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
    // ---- 1. The team member's hours ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    await manager.goto(BASE + "/admin/meetings");
    await settle(manager);
    await manager.getByRole("heading", { name: "שעות זמינות לפגישות" }).waitFor();
    assert.equal(await manager.getByLabel("ראשון מ-").first().inputValue(), "09:00");
    // Add evening hours on Wednesday and save.
    await manager.locator("button[aria-label='הוספת טווח: רביעי']").click();
    await manager.click("button:has-text('שמירת השעות')");
    await manager.locator("[role=status]", { hasText: "שעות הזמינות נשמרו" }).first().waitFor();
    await axe(manager, "staff meetings page");
    await manager.screenshot({ path: OUT + "/staff-page.png", fullPage: true });
    log("the team member saved their hours");

    // ---- 2. A case of the client, handled by the manager ----
    const r = await manager.request.fetch(BASE + "/api/admin/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title: `פגישה ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" },
    });
    assert.equal(r.status(), 200);
    const caseId = (await r.json()).data.id;

    // ---- 3. The client books a video meeting ----
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(client);
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=meetings`);
    await settle(client);
    await client.click("button:has-text('קביעת פגישה')");
    const dlg = client.locator("dialog[open]");
    await dlg.waitFor();
    await dlg.locator("legend:has-text('שעה פנויה')").waitFor({ timeout: 15000 });
    const times = dlg.locator("fieldset label");
    assert.ok((await times.count()) > 0, "free times are offered");
    const pickedTime = (await times.first().innerText()).trim();
    await times.first().click();
    await dlg.getByLabel("על מה תרצו לדבר? (לא חובה)").fill("שאלות על הוויזה");
    await axe(client, "booking dialog");
    await client.screenshot({ path: OUT + "/book-dialog.png" });
    await dlg.locator("button:has-text('קביעת הפגישה')").click();
    await client.locator("[role=status]", { hasText: "הפגישה נקבעה" }).first().waitFor();
    await settle(client);
    const item = client.locator("li", { hasText: "שאלות על הוויזה" }).first();
    await item.waitFor();
    assert.match(await item.innerText(), new RegExp(pickedTime.replace(/[^\d:]/g, "")));
    await axe(client, "client meetings tab");
    await client.screenshot({ path: OUT + "/client-booked.png", fullPage: true });
    const ics = await (await client.request.get(BASE + (await item.locator("a:has-text('הוספה ליומן')").getAttribute("href")))).text();
    assert.match(ics, /BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z/);
    log("the client booked a free slot and got an .ics file");

    // ---- 4. The team member sees it and moves it ----
    await manager.goto(`${BASE}/admin/cases/${caseId}?tab=meetings`);
    await settle(manager);
    const sItem = manager.locator("li", { hasText: "שאלות על הוויזה" }).first();
    await sItem.waitFor();
    await sItem.locator("button:has-text('שינוי מועד')").click();
    const mdlg = manager.locator("dialog[open]");
    await mdlg.waitFor();
    // Next Sunday 18:30 (outside regular hours: staff may book any free time).
    const next = new Date();
    next.setDate(next.getDate() + ((7 - next.getDay()) % 7 || 7));
    const iso = next.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    await mdlg.getByLabel("תאריך").fill(iso);
    await mdlg.getByLabel("שעה").fill("18:30");
    await axe(manager, "move meeting dialog");
    await mdlg.locator("button:has-text('שינוי מועד')").click();
    await manager.locator("[role=status]", { hasText: "הפגישה הועברה" }).first().waitFor();
    await settle(manager);
    assert.match(await manager.locator("li", { hasText: "שאלות על הוויזה" }).first().innerText(), /18:30/);
    await manager.goto(BASE + "/admin/meetings");
    await settle(manager);
    await manager.locator("li", { hasText: `פגישה ${stamp}` }).first().waitFor();
    log("the team member moved the meeting; it's on their schedule");

    // ---- 5. The client cancels ----
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=meetings`);
    await settle(client);
    const cItem = client.locator("li", { hasText: "שאלות על הוויזה" }).first();
    assert.match(await cItem.innerText(), /18:30/);
    client.once("dialog", (d) => d.accept());
    await cItem.locator("button:has-text('ביטול הפגישה')").click();
    await client.locator("[role=status]", { hasText: "הפגישה בוטלה" }).first().waitFor();
    await settle(client);
    await client.getByText("עדיין לא נקבעו פגישות.").waitFor();
    log("the client cancelled; it moved to past meetings");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nMEETINGS: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("MEETINGS FAILED:", e);
  process.exit(1);
});
