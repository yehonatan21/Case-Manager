// Document checklists in the browser: the admin edits a service template's checklist (Settings), a manager
// requests it on a case (choosing items), the client sees one to-do and the checklist progress, uploads a
// document and the progress updates, and documents can't be requested twice. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/checklist.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "checklist");
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
    // ---- 1. Admin adds a document to the visa template's checklist ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings?tab=templates");
    await settle(admin);
    const card = admin.locator("li", { hasText: "הכנת בקשת ויזה" }).first();
    await card.getByText("צילום דרכון בתוקף").waitFor(); // seeded checklist is shown
    await card.locator("button:has-text('עריכה')").click();
    const required = admin.getByLabel("מסמכי חובה מהלקוח");
    assert.match(await required.inputValue(), /צילום דרכון בתוקף \| עמוד התמונה/);
    const extra = `אישור תושבות ${stamp}`;
    // Drop a document left by an earlier run against the same database, so the counts below stay fixed.
    const kept = (await required.inputValue()).split("\n").filter((l) => !/^אישור תושבות \d+/.test(l)).join("\n");
    await required.fill(`${kept}\n${extra} | מהשנה האחרונה`);
    await admin.locator("button:has-text('שמירה')").last().click();
    await admin.locator("[role=status]").first().waitFor();
    await settle(admin);
    await admin.locator("li", { hasText: "הכנת בקשת ויזה" }).first().getByText(extra).waitFor();
    await axe(admin, "settings → templates");
    log("admin added a document to the template's checklist");

    // ---- 2. Manager requests the checklist on a client's case, without the optional CV ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    const title = `ויזת עבודה ${stamp}`;
    const r = await manager.request.fetch(BASE + "/api/admin/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title, description: "בדיקה", serviceCategory: "immigration_visa", urgency: "normal" },
    });
    assert.equal(r.status(), 200);
    const caseId = (await r.json()).data.id;
    await manager.goto(`${BASE}/admin/cases/${caseId}?tab=documents`);
    await settle(manager);
    await manager.click("button:has-text('בקשת רשימת מסמכים')");
    const dlg = manager.locator("dialog[open]");
    await dlg.waitFor();
    // The case's category comes first; the API suite may have added other visa templates, so pick ours by name.
    const select = dlg.locator("select");
    const options = await select.locator("option").allInnerTexts();
    assert.ok(options.indexOf(options.find((o) => /הכנת בקשת ויזה/.test(o))) < options.findIndex((o) => /עסק|אזרחות/.test(o)) || !options.some((o) => /עסק|אזרחות/.test(o)), "templates for the case's service are listed first");
    await select.selectOption({ label: options.find((o) => /הכנת בקשת ויזה/.test(o)) });
    await dlg.getByText(extra).waitFor();
    await dlg.locator("label", { hasText: "קורות חיים" }).locator("input").uncheck();
    await axe(manager, "request-checklist dialog");
    await dlg.locator("button:has-text('בקשת 4 מסמכים')").click();
    await manager.locator("[role=status]", { hasText: "התבקשו 4 מסמכים" }).first().waitFor();
    await settle(manager);
    await manager.getByText("סופקו 0 מתוך 4 מסמכי חובה").waitFor();
    await manager.screenshot({ path: OUT + "/staff.png", fullPage: true });
    log("manager requested 4 documents in one step");

    // Requesting again: the documents are marked as already requested and nothing is selected.
    await manager.click("button:has-text('בקשת רשימת מסמכים')");
    await dlg.waitFor();
    assert.equal(await dlg.locator("label", { hasText: "צילום דרכון בתוקף" }).locator("input").isDisabled(), true);
    await dlg.getByText("כבר התבקש").first().waitFor();
    assert.equal(await dlg.locator("button:has-text('בקשת 1 מסמכים')").count(), 1, "only the CV is left to request");
    await manager.keyboard.press("Escape");
    log("already-requested documents can't be requested twice");

    // ---- 3. The client: one to-do, the checklist, upload one document ----
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(client);
    await client.goto(`${BASE}/portal/cases/${caseId}`);
    await settle(client);
    await client.getByText("העלאת 4 מסמכים שהתבקשו").waitFor();
    assert.equal(await client.getByText("העלאת מסמך שהתבקש").count(), 0, "one combined action, not four");
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=documents`);
    await settle(client);
    const summary = client.locator("section[aria-labelledby=checklist-title]");
    await summary.getByText("סופקו 0 מתוך 4 מסמכי חובה").waitFor();
    assert.match(await summary.innerText(), /צילום דרכון בתוקף/);
    await axe(client, "client documents tab");
    await client.screenshot({ path: OUT + "/client-before.png", fullPage: true });
    const row = client.locator("li", { hasText: "צילום דרכון בתוקף", has: client.locator("input[type=file]") }).first();
    await row.locator("input[type=file]").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 passport") });
    await summary.getByText("סופקו 1 מתוך 4 מסמכי חובה").waitFor({ timeout: 15000 });
    assert.doesNotMatch(await summary.innerText(), /עדיין חסרים:.*צילום דרכון בתוקף/);
    await client.screenshot({ path: OUT + "/client-after.png", fullPage: true });
    log("client uploaded one document; progress 1 of 4");

    // The client got one message listing all four.
    await client.goto(`${BASE}/portal/notifications`);
    await settle(client);
    const msg = await client.locator("main li", { hasText: "נדרשים 4 מסמכים" }).first().innerText();
    assert.match(msg, /• צילום דרכון בתוקף/);
    assert.match(msg, new RegExp(`• ${extra}`));
    log("one notification with the whole list");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nCHECKLIST: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("CHECKLIST FAILED:", e);
  process.exit(1);
});
