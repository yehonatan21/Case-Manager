// Grow payments end to end, against a local stand-in for Grow's API (started by this script on :4010):
// admin connects Grow on the Payments page → customer enters payer details (validated) → Grow's page →
// server update to our notifyUrl → we confirm with getTransactionInfo and acknowledge with approveTransaction
// → case becomes active. Then a cancelled payment, and disconnecting Grow.
// Requires the app to run in demo mode with GROW_API_URL=http://localhost:4010:
//   GROW_API_URL=http://localhost:4010 DEMO_MODE=true ... npm start
//   BASE=http://localhost:3000 node e2e/grow.cjs
const http = require("node:http");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const GROW_PORT = Number(process.env.FAKE_GROW_PORT || 4010);
const OUT = path.join(__dirname, "screenshots", "grow");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1200);
const codeOnScreen = async (p) => (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];

// ---------- Fake Grow ----------
const grow = { processes: new Map(), calls: [], nextTx: 900000 };
async function readForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const form = await new Response(body, { headers: { "content-type": req.headers["content-type"] || "" } }).formData();
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}
const json = (res, obj) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};
const fakeGrow = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${GROW_PORT}`);
  const method = url.pathname.split("/").pop();
  try {
    if (req.method === "POST" && method === "createPaymentProcess") {
      const f = await readForm(req);
      grow.calls.push({ method, fields: f });
      if (!f.pageCode || !f.userId) return json(res, { status: 0, err: { id: 1, message: "bad page" }, data: "" });
      const pid = String(grow.processes.size + 1);
      grow.processes.set(pid, { ...f, processId: pid, processToken: `ptok${pid}` });
      return json(res, { status: 1, err: "", data: { url: `http://localhost:${GROW_PORT}/pay/${pid}`, processId: pid, processToken: `ptok${pid}` } });
    }
    if (req.method === "POST" && method === "getTransactionInfo") {
      const f = await readForm(req);
      grow.calls.push({ method, fields: f });
      const p = [...grow.processes.values()].find((x) => x.transactionId === f.transactionId && x.transactionToken === f.transactionToken);
      if (!p) return json(res, { status: 0, err: { id: 716, message: "פרמטר קוד עסקה או תוקן אינו תקין" }, data: "" });
      return json(res, { status: 1, err: "", data: { transactionId: p.transactionId, transactionToken: p.transactionToken, statusCode: "2", status: "שולם", sum: p.sum, asmachta: "0289199", transactionTypeId: "1", paymentType: "2", processId: p.processId, processToken: p.processToken, fullName: p["pageField[fullName]"], payerPhone: p["pageField[phone]"] } });
    }
    if (req.method === "POST" && method === "approveTransaction") {
      grow.calls.push({ method, fields: await readForm(req) });
      return json(res, { status: 1, err: "", data: "" });
    }
    const m = url.pathname.match(/^\/pay\/(\d+)(\/(paid|cancel))?$/);
    if (m && grow.processes.has(m[1])) {
      const p = grow.processes.get(m[1]);
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><title>Grow (test)</title><h1>Grow test payment</h1><p id="sum">${p.sum}</p><p id="name">${p["pageField[fullName]"]}</p>
          <form method="post" action="/pay/${m[1]}/paid"><button>Pay</button></form><form method="post" action="/pay/${m[1]}/cancel"><button>Cancel</button></form>`);
      }
      if (m[3] === "cancel") {
        res.writeHead(303, { location: p.cancelUrl });
        return res.end();
      }
      // Paid: send the server update to the notifyUrl (nested data[...] form fields), then return the customer.
      p.transactionId = String(grow.nextTx++);
      p.transactionToken = `tt${p.transactionId}abcdef`;
      const update = new URLSearchParams({ status: "1", err: "", "data[transactionId]": p.transactionId, "data[transactionToken]": p.transactionToken, "data[sum]": p.sum, "data[statusCode]": "2", "data[asmachta]": "0289199", "data[processId]": p.processId, "data[processToken]": p.processToken, "data[customFields][cField1]": p.cField1 });
      const r = await fetch(p.notifyUrl, { method: "POST", body: update, headers: { "content-type": "application/x-www-form-urlencoded" } });
      p.notifyStatus = r.status;
      res.writeHead(303, { location: p.successUrl });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    console.error("fake grow error", e);
    res.writeHead(500);
    res.end();
  }
});

(async () => {
  await new Promise((r) => fakeGrow.listen(GROW_PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  const stamp = Date.now();
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    // ---- Admin connects Grow on the Payments page ----
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
    const admin = await ctx.newPage();
    watch(admin);
    await admin.goto(BASE + "/login?as=admin%40example.com");
    await settle(admin);
    await admin.fill('input[autocomplete="one-time-code"]', await codeOnScreen(admin));
    await admin.click("button[type=submit]");
    await admin.waitForURL((u) => new URL(u).pathname.startsWith("/admin"), { timeout: 20000 });
    await admin.goto(BASE + "/admin/payments");
    await settle(admin);
    await admin.getByText("Grow לא מחובר").waitFor();
    await admin.click("button:has-text('חיבור Grow')");
    await admin.getByLabel("מזהה משתמש (userId)").fill("4ec1d595ae764243");
    await admin.getByLabel("קוד דף (pageCode)").fill("0b7a16e03b25");
    assert.equal(await admin.getByLabel("מצב בדיקה (סביבת sandbox של Grow)").isChecked(), true, "test mode by default");
    await admin.click("button:has-text('שמירה וחיבור')");
    await admin.getByText("Grow מחובר (מצב בדיקה)").waitFor();
    await admin.getByText("••••4243").waitFor();
    assert.equal(await admin.locator("text=4ec1d595ae764243").count(), 0, "full id never shown");
    await admin.screenshot({ path: OUT + "/admin-connected.png", fullPage: true });
    log("admin connected Grow (test mode); only hints shown");

    // ---- A case awaiting payment (admin opens it for a new client and sends a quote) ----
    const clientEmail = `grow-${stamp}@example.com`;
    const api = (method, url, data) => admin.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    const created = await api("POST", "/api/admin/cases", { customer: { email: clientEmail, name: "נועם", customerType: "private", locale: "he" }, title: `תשלום Grow ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const caseId = created.json.data.id;
    const q = await api("POST", `/api/cases/${caseId}/quotes`, {});
    const quoteId = q.json.data.id;
    const patched = await api("PATCH", `/api/quotes/${quoteId}`, { serviceName: "Visa service", scope: "Scope", included: "", excluded: "", currency: "ILS", taxRate: 18, pricesIncludeTax: false, paymentTerms: "", timeline: "", terms: "", validUntil: null, items: [{ description: "Item", quantity: 1, unitPriceCents: 100000 }] });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.equal((await api("POST", `/api/quotes/${quoteId}/send`, {})).status, 200);
    log("case with a quote of 1,180.00 ILS");

    // ---- The client approves and pays ----
    const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
    const client = await cctx.newPage();
    watch(client);
    await client.goto(BASE + "/login");
    await settle(client);
    await client.fill("input[type=email]", clientEmail);
    await client.click("button[type=submit]");
    await client.fill('input[autocomplete="one-time-code"]', await codeOnScreen(client));
    await client.click("button[type=submit]");
    await client.waitForURL((u) => new URL(u).pathname === "/portal", { timeout: 20000 });
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=quote`);
    await settle(client);
    
    await client.locator("input[type=checkbox]").first().check();
    await client.click("button:has-text('אישור הצעת המחיר')");
    await client.locator("button:has-text('מעבר לתשלום מאובטח')").waitFor({ timeout: 15000 });
    await client.click("button:has-text('מעבר לתשלום מאובטח')");

    // Payer details: one-word name and a landline are refused; Continue waits for the terms.
    const dialog = client.getByRole("dialog");
    await dialog.getByText("פרטים לתשלום").waitFor();
    assert.equal(await dialog.getByLabel("שם מלא").inputValue(), "נועם", "prefilled from the profile");
    const cont = dialog.locator("button:has-text('המשך לתשלום')");
    await dialog.getByLabel("טלפון נייד").fill("03-1234567");
    assert.equal(await cont.isDisabled(), true, "terms first");
    await dialog.locator("input[type=checkbox]").check();
    await cont.click();
    await client.locator("[role=alert]", { hasText: "שם מלא" }).first().waitFor();
    await dialog.getByLabel("שם מלא").fill("נועם ישראלי");
    await cont.click();
    await client.locator("[role=alert]", { hasText: "נייד ישראלי" }).first().waitFor();
    await dialog.getByLabel("טלפון נייד").fill("050-123-4567");
    await client.screenshot({ path: OUT + "/payer-details.png", fullPage: true });
    await cont.click();
    log("payer details validated (name, mobile, terms)");

    // Grow's page → pay → back on the case, paid.
    await client.waitForURL((u) => String(u).startsWith(`http://localhost:${GROW_PORT}/pay/`), { timeout: 20000 });
    assert.equal(await client.locator("#sum").innerText(), "1180.00");
    assert.equal(await client.locator("#name").innerText(), "נועם ישראלי");
    const proc = [...grow.processes.values()].pop();
    assert.equal(proc["pageField[phone]"], "0501234567");
    assert.match(proc.notifyUrl, /\/api\/webhooks\/grow\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
    await client.click("button:has-text('Pay')");
    await client.waitForURL((u) => new URL(u).pathname === `/portal/cases/${caseId}`, { timeout: 20000 });
    assert.equal(proc.notifyStatus, 200, "our server accepted Grow's update");
    await settle(client);
    await client.getByText("התשלום התקבל ואושר").first().waitFor({ timeout: 15000 });
    await client.screenshot({ path: OUT + "/paid.png", fullPage: true });
    const methods = grow.calls.map((c) => c.method);
    assert.deepEqual(methods.slice(-3), ["createPaymentProcess", "getTransactionInfo", "approveTransaction"]);
    log("paid on Grow's page → update confirmed with Grow, acknowledged, case active");

    // The admin sees the Grow payment.
    await admin.goto(BASE + "/admin/payments");
    await settle(admin);
    const row = admin.locator("tbody tr", { hasText: `תשלום Grow ${stamp}` }).first();
    await row.waitFor().catch(() => {});
    assert.match(await admin.locator("tbody").innerText(), /grow/i);
    log("payment listed for the admin");

    // ---- Disconnect: checkout goes back to the previous provider ----
    admin.once("dialog", (dlg) => dlg.accept());
    await admin.click("button:has-text('ניתוק')");
    await admin.getByText("Grow לא מחובר").waitFor();
    const health = await (await fetch(BASE + "/api/health")).json();
    assert.notEqual(health.payments, "grow");
    log("disconnected; health reports", health.payments);

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nGROW: all passed");
  } finally {
    // Never leave Grow connected for the next scripts.
    try {
      const ctx = browser.contexts()[0];
      if (ctx) await ctx.request.fetch(BASE + "/api/admin/payments/grow", { method: "DELETE" });
    } catch {}
    await browser.close();
    fakeGrow.close();
  }
})().catch((e) => {
  console.error("GROW FAILED:", e);
  process.exit(1);
});
