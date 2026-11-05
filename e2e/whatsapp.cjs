// WhatsApp end to end, against a local stand-in for Meta's Graph API (started by this script on :4014):
// the admin connects the business number in Settings → Integrations (credentials checked with "Meta"), the
// webhook's verify handshake works, a client opts in on their profile, a message from the team reaches the
// client as the approved template, the client's WhatsApp reply (signed webhook) shows up in the case with a
// "WhatsApp" label, a file they send is added to the case's documents, and unsigned deliveries are refused.
// axe runs on the new screens.
// Requires the app to run in demo mode with WHATSAPP_API_URL=http://localhost:4014:
//   WHATSAPP_API_URL=http://localhost:4014 DEMO_MODE=true ... npm start
//   BASE=http://localhost:3000 node e2e/whatsapp.cjs
const http = require("node:http");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const PORT = Number(process.env.FAKE_WHATSAPP_PORT || 4014);
const OUT = path.join(__dirname, "screenshots", "whatsapp");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

// ---------- Fake Meta Graph API ----------
const PHONE_ID = "109876543210987";
const TOKEN = "EAAe2e-test-access-token-0123456789";
const SECRET = "e2eappsecret0123456789ab";
const PDF = Buffer.from("%PDF-1.4 e2e passport from whatsapp");
const sent = [];
let nextId = 0;
const meta = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const json = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { message: "Invalid OAuth access token", code: 190 } });
    if (req.method === "GET" && url.pathname === `/${PHONE_ID}`) return json(200, { display_phone_number: "+972 3-555-0199", verified_name: "E2E Office", id: PHONE_ID });
    if (req.method === "POST" && url.pathname === `/${PHONE_ID}/messages`) {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const id = `wamid.e2e.${++nextId}`;
      sent.push({ id, ...body });
      return json(200, { messaging_product: "whatsapp", contacts: [{ wa_id: body.to }], messages: [{ id }] });
    }
    if (req.method === "GET" && url.pathname === "/media-1") return json(200, { url: `http://localhost:${PORT}/files/1`, mime_type: "application/pdf" });
    if (req.method === "GET" && url.pathname === "/files/1") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(PDF);
    }
    json(404, { error: { message: "Unknown", code: 100 } });
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
  // Next.js streams the <title> in just after the page loads; check once it's there, as a visitor would.
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(", ")}`));
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}
const signed = (raw) => "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
const webhook = (raw, signature) => fetch(`${BASE}/api/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body: raw });
const inbound = (from, message) =>
  JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_ID }, messages: [{ from, id: `wamid.in.${crypto.randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });

(async () => {
  await new Promise((r) => meta.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  let admin;
  try {
    // ---- 1. Admin connects WhatsApp ----
    admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings?tab=integrations");
    await settle(admin);
    await admin.click("button:has-text('חיבור WhatsApp')");
    await admin.getByLabel("מזהה מספר הטלפון (Phone number ID)").fill(PHONE_ID);
    await admin.getByLabel("סוד האפליקציה (App secret)").fill(SECRET);
    // A wrong token: WhatsApp refuses it and nothing is saved.
    await admin.getByLabel("אסימון גישה (Access token)").fill("EAA-not-the-right-token-000000");
    await axe(admin, "WhatsApp connect form");
    await admin.click("button:has-text('בדיקה ושמירה')");
    await admin.locator("[role=alert]", { hasText: "WhatsApp לא אישר את פרטי החיבור" }).first().waitFor();
    await admin.getByLabel("אסימון גישה (Access token)").fill(TOKEN);
    await admin.click("button:has-text('בדיקה ושמירה')");
    await admin.locator("[role=status]", { hasText: "WhatsApp מחובר" }).first().waitFor();
    await settle(admin);
    await admin.getByText("+972 3-555-0199").waitFor();
    const verifyToken = (await admin.locator("dt:has-text('Verify token') + dd code").innerText()).trim();
    const callbackUrl = (await admin.locator("dt:has-text('Callback URL') + dd code").innerText()).trim();
    assert.match(callbackUrl, /\/api\/webhooks\/whatsapp$/);
    // The Google Calendar card is here too (Google sign-in isn't configured on the test server).
    await admin.getByRole("heading", { name: "יומן Google" }).waitFor();
    await axe(admin, "settings → integrations (connected)");
    await admin.screenshot({ path: OUT + "/settings.png", fullPage: true });
    log("admin connected WhatsApp; the number and webhook details are shown");

    // Meta's verification handshake.
    const ok = await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=4242`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "4242");
    assert.equal((await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=4242`)).status, 403);
    log("webhook verify handshake works, a wrong token is refused");

    // ---- 2. The client opts in on their profile ----
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(client);
    await client.goto(BASE + "/portal/profile");
    await settle(client);
    await client.getByLabel("טלפון").fill("054-9876543");
    await client.getByLabel("קבלת עדכונים ב-WhatsApp").check();
    await axe(client, "profile with WhatsApp opt-in");
    await client.click("button:has-text('שמירה')");
    await client.locator("[role=status]", { hasText: "הפרופיל עודכן" }).first().waitFor();
    await client.screenshot({ path: OUT + "/profile.png", fullPage: true });
    log("client opted in with 054-9876543");

    // ---- 3. A message from the team reaches the client on WhatsApp ----
    const manager = await signIn(browser, "manager@example.com");
    watch(manager);
    const r = await manager.request.fetch(BASE + "/api/admin/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title: `WhatsApp ${Date.now()}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" },
    });
    assert.equal(r.status(), 200);
    const caseId = (await r.json()).data.id;
    await manager.goto(`${BASE}/admin/cases/${caseId}`);
    await settle(manager);
    const before = sent.length;
    const post = await manager.request.fetch(`${BASE}/api/cases/${caseId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, data: { body: "נא לשלוח צילום דרכון", kind: "thread", isInfoRequest: true } });
    assert.equal(post.status(), 200);
    const update = await waitFor(() => sent.slice(before).find((m) => m.to === "972549876543" && m.template && m.template.components[0].parameters[3].text.includes(caseId)), "the template to the client");
    assert.equal(update.template.name, "case_update");
    assert.equal(update.template.language.code, "he");
    assert.equal(update.template.components[0].parameters.length, 4);
    log("the team's message went to the client as the approved template");

    // ---- 4. The client replies on WhatsApp ----
    assert.equal((await webhook(inbound("972549876543", { type: "text", text: { body: "שלחתי" } }), "sha256=" + "0".repeat(64))).status, 401);
    assert.equal((await webhook(inbound("972549876543", { type: "text", text: { body: "שלחתי" } }), null)).status, 401);
    const rawReply = inbound("972549876543", { type: "text", text: { body: "מצרף את הדרכון עכשיו" }, context: { id: update.id } });
    const res = await webhook(rawReply, signed(rawReply));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.messages, 1);
    // Delivered twice by WhatsApp: added once.
    assert.equal((await (await webhook(rawReply, signed(rawReply))).json()).data.messages, 0);
    const rawFile = inbound("972549876543", { type: "document", document: { id: "media-1", mime_type: "application/pdf", filename: "passport.pdf", caption: "צילום דרכון" } });
    assert.equal((await webhook(rawFile, signed(rawFile))).status, 200);
    log("signed replies are accepted (once each); unsigned or badly signed ones are refused");

    await manager.goto(`${BASE}/admin/cases/${caseId}`);
    await settle(manager);
    const bubble = manager.locator("div", { hasText: "מצרף את הדרכון עכשיו" }).last();
    await bubble.waitFor();
    assert.equal(await manager.locator("p:has-text('WhatsApp')").count() >= 1, true, "the message is labelled WhatsApp");
    await axe(manager, "case with a WhatsApp message");
    await manager.screenshot({ path: OUT + "/case.png", fullPage: true });
    await manager.goto(`${BASE}/admin/cases/${caseId}?tab=documents`);
    await settle(manager);
    await manager.getByText("צילום דרכון").first().waitFor();
    log("the reply shows in the case with a WhatsApp label, and the file is in the documents");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nWHATSAPP: all passed");
  } finally {
    // Leave the server as other scripts expect it: WhatsApp disconnected.
    if (admin) await admin.request.fetch(BASE + "/api/admin/whatsapp", { method: "DELETE" }).catch(() => {});
    await browser.close();
    meta.close();
  }
})().catch((e) => {
  console.error("WHATSAPP FAILED:", e);
  process.exit(1);
});
