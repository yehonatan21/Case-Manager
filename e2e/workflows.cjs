// Workflows in the browser: an admin writes a work plan (stages, tasks that wait) in a service template and an
// automation rule; a case manager applies the plan to a case, completes tasks (the next one unlocks, the stage
// completes, the rule's message goes out); the client sees the stages; the Conversations inbox shows the client's
// question and the team answers it with a saved reply. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/workflows.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "workflows");
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
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  let admin;
  let ruleIds = [];
  try {
    // ---- 1. Admin: a work plan in a template, an automation rule, a saved reply ----
    admin = await signIn(browser, "admin@example.com");
    watch(admin);
    const api = (page, method, url, data) => page.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    await admin.goto(BASE + "/admin/settings?tab=templates");
    await settle(admin);
    const tplName = `תוכנית ${stamp}`;
    await admin.getByLabel("שם התבנית").fill(tplName);
    await admin.getByLabel("תוכנית עבודה: שלבים ומשימות").fill(["## איסוף מסמכים | 7", "בקשת מסמכים", "> בדיקת המסמכים | 5", "## הגשה | 14", "> הגשת הבקשה"].join("\n"));
    await axe(admin, "template work plan editor");
    await admin.locator("button:has-text('שמירה')").filter({ hasText: /^שמירה$/ }).last().click();
    await admin.locator("[role=status]", { hasText: "נשמר" }).first().waitFor();
    log("admin wrote a work plan with two stages and waiting tasks");

    await admin.goto(BASE + "/admin/settings?tab=automation");
    await settle(admin);
    await admin.getByRole("heading", { name: "כללי אוטומציה" }).waitFor();
    await admin.locator("button:has-text('כלל חדש')").click();
    await admin.getByLabel("שם הכלל").fill(`שלב הושלם ${stamp}`);
    await admin.getByLabel("כאשר").selectOption("milestone_completed");
    await admin.getByLabel("אז").selectOption("message_client");
    await admin.getByLabel("הודעה בעברית").fill("שלום {client}, סיימנו שלב בתיק {number}.");
    await axe(admin, "automation rule form");
    await admin.locator("button:has-text('שמירת הכלל')").click();
    await admin.locator("[role=status]", { hasText: "הכלל נשמר" }).first().waitFor();
    await settle(admin);
    await admin.getByText(`שלב הושלם ${stamp}`).waitFor();
    ruleIds = (await api(admin, "GET", "/api/admin/automation")).json.data.filter((r) => r.name.endsWith(String(stamp))).map((r) => r.id);
    await admin.screenshot({ path: OUT + "/automation.png", fullPage: true });
    log("admin added a rule: stage done → message the client");

    // ---- 2. The case manager applies the plan and works through it ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    const created = await api(manager, "POST", "/api/admin/cases", { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title: `תיק עבודה ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const caseId = created.json.data.id;
    await manager.goto(`${BASE}/admin/cases/${caseId}?tab=tasks`);
    await settle(manager);
    await manager.getByLabel("יצירה מתבנית").selectOption({ label: tplName });
    await manager.getByRole("heading", { name: "איסוף מסמכים" }).waitFor();
    await manager.getByText("ממתינה ל: בקשת מסמכים").waitFor();
    await axe(manager, "tasks grouped by stage");
    await manager.screenshot({ path: OUT + "/work-plan.png", fullPage: true });
    // The checkbox shows the saved state, so it turns on once the server has the change.
    const markDone = async (title) => {
      const box = manager.getByLabel(`סימון כהושלם: ${title}`, { exact: true });
      await box.click();
      await manager.waitForFunction((label) => document.querySelector(`input[aria-label="${label}"]`)?.checked, `סימון כהושלם: ${title}`, { timeout: 15000 });
    };
    await markDone("בקשת מסמכים");
    await settle(manager);
    assert.equal(await manager.getByText("ממתינה ל: בקשת מסמכים").count(), 0, "the next task unlocked");
    await markDone("בדיקת המסמכים");
    await settle(manager);
    await manager.getByRole("button", { name: "פתיחת השלב מחדש" }).first().waitFor();
    log("completing tasks unlocked the next one and completed the stage");

    // ---- 3. The client sees the stages and the rule's message, and asks something ----
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(client);
    await client.goto(`${BASE}/portal/cases/${caseId}`);
    await settle(client);
    await client.getByRole("heading", { name: "שלבי הטיפול בתיק" }).waitFor();
    await client.getByText("איסוף מסמכים").first().waitFor();
    await client.getByText("בטיפול").first().waitFor();
    await axe(client, "client work plan stages");
    await client.screenshot({ path: OUT + "/client-stages.png", fullPage: true });
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=messages`);
    await settle(client);
    await client.getByText("סיימנו שלב בתיק").first().waitFor();
    await client.getByText("הודעה אוטומטית").first().waitFor();
    const question = `מתי מגישים? ${stamp}`;
    assert.equal((await api(client, "POST", `/api/cases/${caseId}/messages`, { body: question, kind: "thread" })).status, 200);
    log("the client sees the stages and the automatic message, and asks a question");

    // ---- 4. Conversations inbox with a saved reply ----
    assert.equal((await api(manager, "POST", "/api/reply-templates", { title: `עדכון ${stamp}`, bodyHe: "שלום {client}, אנחנו מטפלים בתיק {number} ונעדכן בקרוב.", bodyEn: "" })).status, 200);
    await manager.goto(BASE + "/admin/conversations");
    await settle(manager);
    const item = manager.locator("li", { hasText: question }).first();
    await item.waitFor();
    await item.getByText("ממתינה לתשובה").waitFor();
    await axe(manager, "conversations inbox");
    await item.locator("button:has-text('תשובה')").click();
    await item.getByLabel("הכנסת תשובה שמורה…").focus();
    await settle(manager);
    await item.getByLabel("הכנסת תשובה שמורה…").selectOption({ label: `עדכון ${stamp}` });
    assert.match(await item.locator("textarea").inputValue(), /אנחנו מטפלים בתיק/);
    // The Send button fades from disabled to enabled; check contrast once the fade is over.
    const sendBtn = item.locator("button:has-text('שליחה')");
    await manager.waitForFunction((el) => !el.disabled, await sendBtn.elementHandle(), { timeout: 10000 });
    await manager.mouse.move(0, 0);
    await manager.waitForTimeout(500);
    await axe(manager, "quick reply with saved reply");
    await manager.screenshot({ path: OUT + "/conversations.png", fullPage: true });
    await item.locator("button:has-text('שליחה')").click();
    await manager.locator("[role=status]", { hasText: "התשובה נשלחה" }).first().waitFor();
    await settle(manager);
    assert.equal(await manager.locator("li", { hasText: question }).count(), 0, "answered: no longer waiting");
    log("the team answered from the Conversations inbox with a saved reply");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nWORKFLOWS: all passed");
  } finally {
    // Leave no rules behind for other scripts.
    if (admin) for (const id of ruleIds) await admin.request.fetch(`${BASE}/api/admin/automation/${id}`, { method: "DELETE" }).catch(() => {});
    await browser.close();
  }
})().catch((e) => {
  console.error("WORKFLOWS FAILED:", e);
  process.exit(1);
});
