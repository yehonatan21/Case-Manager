// Release E in the browser: a team member turns on two-step sign-in (QR key → code → recovery codes) and signs in
// with a recovery code; an admin resets it; requiring it for all staff sends a team member to set it up first; the
// activity log shows and exports what happened; a browser error shows up in System health and is marked fixed.
// axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/release-e.cjs
const { chromium } = require("playwright");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "release-e");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

// ---------- An authenticator app, in a few lines ----------
function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/[\s=]/g, "")) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

async function emailCode(p, email) {
  await p.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  await settle(p);
  const code = (await p.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await p.fill('input[autocomplete="one-time-code"]', code);
  await p.click("button[type=submit]");
}
async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he", timezoneId: "Asia/Jerusalem" });
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.accept());
  await emailCode(p, email);
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
    await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
    v = await run();
  }
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}
/** Turns on two-step sign-in on My account; returns the secret and the recovery codes. */
async function turnOn(p) {
  await p.locator("button:has-text('הפעלת כניסה בשני שלבים')").click();
  const secret = (await p.locator("p.select-all").innerText()).replace(/\s/g, "");
  await p.getByLabel(/^2\. הקלידו את הקוד/).fill(totp(secret));
  await p.locator("button:has-text('הפעלה')").click();
  await p.getByRole("heading", { name: "קודי השחזור שלכם" }).waitFor();
  const codes = (await p.locator("ol li").allInnerTexts()).map((s) => s.trim());
  assert.equal(codes.length, 10);
  return { secret, codes };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  let admin;
  try {
    // ---- 1. A team member turns on two-step sign-in ----
    const staff = await signIn(browser, "staff@example.com");
    watch(staff);
    await staff.getByRole("link", { name: "החשבון שלי" }).first().click();
    await staff.waitForURL(/\/admin\/account/);
    await staff.getByRole("heading", { name: "כניסה בשני שלבים" }).waitFor();
    await axe(staff, "my account");
    await staff.locator("button:has-text('הפעלת כניסה בשני שלבים')").click();
    await staff.locator("[role=img] svg").waitFor();
    await axe(staff, "two-step setup (QR code)");
    await staff.reload();
    await settle(staff);
    const { codes } = await turnOn(staff);
    await axe(staff, "recovery codes");
    await staff.screenshot({ path: OUT + "/recovery-codes.png", fullPage: true });
    await staff.locator("button:has-text('שמרתי אותם')").click();
    await staff.getByText("פעיל", { exact: true }).first().waitFor();
    log("the team member turned on two-step sign-in and got 10 recovery codes");

    // ---- 2. Signing in again asks for the code; a recovery code works ----
    await staff.request.fetch(BASE + "/api/auth/logout", { method: "POST" });
    await emailCode(staff, "staff@example.com");
    await staff.waitForURL(/\/login\/2fa/);
    await staff.getByRole("heading", { name: "הזינו את הקוד מאפליקציית האימות" }).waitFor();
    await axe(staff, "sign-in second step");
    // Without the second step, staff pages stay closed.
    assert.equal((await staff.request.fetch(BASE + "/api/admin/workload")).status(), 401);
    await staff.locator("button:has-text('שימוש בקוד שחזור במקום')").click();
    await staff.getByLabel(/^קוד שחזור/).fill(codes[0]);
    await staff.locator("button:has-text('המשך')").click();
    await staff.waitForURL((u) => new URL(u).pathname.startsWith("/admin") && !new URL(u).pathname.startsWith("/login"));
    await staff.locator("[role=status]", { hasText: "נכנסתם עם קוד שחזור. נותרו 9" }).first().waitFor();
    log("signing in asked for the second step; a recovery code let them in");

    // ---- 3. The admin sees it and resets it ----
    admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings?tab=users");
    await settle(admin);
    const row = admin.locator("tr", { hasText: "staff@example.com" });
    await row.getByText("פעיל", { exact: true }).first().waitFor();
    await row.getByRole("button", { name: /איפוס כניסה בשני שלבים/ }).click();
    await settle(admin);
    await row.getByText("כבוי", { exact: true }).waitFor();
    log("the admin reset the team member's two-step sign-in");

    // ---- 4. Requiring it for all staff ----
    await admin.goto(BASE + "/admin/settings?tab=general");
    await settle(admin);
    await admin.getByLabel("חיוב כניסה בשני שלבים לכל אנשי הצוות").check();
    await admin.locator("button:has-text('שמירה')").first().click();
    await settle(admin);
    await staff.goto(BASE + "/admin/queue");
    await staff.waitForURL(/\/admin\/account\?setup=1/);
    await staff.getByText("המשרד מחייב כניסה בשני שלבים לצוות").waitFor();
    const blocked = await staff.request.fetch(BASE + "/api/admin/workload");
    assert.equal((await blocked.json()).error.code, "mfa_setup_required");
    log("with it required, the team member was sent to set it up first");
    // The admin has to set it up too, then lifts the requirement and turns their own off again.
    await admin.goto(BASE + "/admin/queue");
    await admin.waitForURL(/\/admin\/account\?setup=1/);
    const mine = await turnOn(admin);
    await admin.locator("button:has-text('שמרתי אותם')").click();
    await admin.goto(BASE + "/admin/settings?tab=general");
    await settle(admin);
    await admin.getByLabel("חיוב כניסה בשני שלבים לכל אנשי הצוות").uncheck();
    await admin.locator("button:has-text('שמירה')").first().click();
    await settle(admin);
    const off = await admin.request.fetch(BASE + "/api/account/2fa", { method: "DELETE", data: { code: mine.codes[0] }, headers: { "content-type": "application/json" } });
    assert.equal(off.status(), 200, await off.text());

    // ---- 5. The activity log ----
    await admin.goto(BASE + "/admin/activity");
    await settle(admin);
    await admin.getByRole("heading", { name: "יומן פעילות" }).waitFor();
    await admin.locator("td", { hasText: "הפעיל/ה כניסה בשני שלבים" }).first().waitFor();
    await admin.getByLabel("סוג").selectOption("auth");
    await admin.locator("button:has-text('סינון')").click();
    await admin.waitForURL(/group=auth/);
    await settle(admin);
    assert.ok((await admin.locator("tbody tr").count()) > 0);
    assert.equal(await admin.locator("td", { hasText: "שלח/ה הצעת מחיר" }).count(), 0);
    await axe(admin, "activity log");
    await admin.screenshot({ path: OUT + "/activity.png", fullPage: true });
    const csv = await admin.request.fetch(BASE + "/api/admin/activity/export?group=auth");
    assert.match(csv.headers()["content-type"], /text\/csv/);
    assert.ok((await csv.text()).startsWith("\uFEFFtime,action,"));
    log("the activity log lists, filters and exports what happened");

    // ---- 6. A browser error reaches System health ----
    await staff.goto(BASE + "/admin");
    await settle(staff);
    await staff.evaluate(() => setTimeout(() => { throw new Error("E2E browser error"); }, 0));
    await staff.waitForTimeout(1500);
    await admin.goto(BASE + "/admin/settings?tab=health");
    await settle(admin);
    const err = admin.locator("#errors li", { hasText: "E2E browser error" });
    await err.waitFor();
    await axe(admin, "system health with an error");
    await admin.screenshot({ path: OUT + "/errors.png", fullPage: true });
    await err.locator("button:has-text('סימון כמטופלת')").click();
    await admin.locator("[role=status]", { hasText: "סומן כמטופל." }).first().waitFor();
    await settle(admin);
    assert.equal(await admin.locator("#errors li", { hasText: "E2E browser error" }).count(), 0);
    log("a browser error showed up in System health and was marked fixed");

    // The thrown test error is expected on the staff page; nothing else.
    assert.deepEqual(errors.filter((m) => !m.includes("E2E browser error")), [], "no page errors");
    console.log("\nRELEASE E: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("RELEASE E FAILED:", e);
  process.exit(1);
});
