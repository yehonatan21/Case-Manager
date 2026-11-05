// Receipts, invoices and client satisfaction in the browser, against a stand-in for Green Invoice's API (started
// by this script on :4016): an admin connects Green Invoice in Settings → Integrations (a wrong key is refused);
// a client pays a quote and gets a tax invoice-receipt in the case's documents; the Payments page shows its number;
// the case is completed and the client rates it; staff see the rating and the reports count it. axe runs on the
// new screens.
// Requires the app in demo mode with INVOICE_API_URL=http://localhost:4016/api/v1:
//   BASE=http://localhost:3000 node e2e/invoices.cjs
const http = require("node:http");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const PORT = Number(process.env.FAKE_INVOICE_PORT || 4016);
const OUT = path.join(__dirname, "screenshots", "invoices");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

// ---------- Fake Green Invoice ----------
const KEY = { id: "e2e-key-id-1234", secret: "e2e-secret-abcdef" };
const PDF = Buffer.from("%PDF-1.4 e2e tax invoice receipt");
const docs = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : null;
    const json = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url === "/api/v1/account/token") return body?.id === KEY.id && body?.secret === KEY.secret ? json(200, { token: "e2e-jwt", expires: Math.floor(Date.now() / 1000) + 3600 }) : json(401, { errorCode: 401, errorMessage: "Invalid credentials" });
    // Download links are signed URLs: no token needed (like Green Invoice's own).
    if (req.url.startsWith("/api/v1/download/")) {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(PDF);
    }
    if (req.headers.authorization !== "Bearer e2e-jwt") return json(401, { errorCode: 401, errorMessage: "Unauthorized" });
    if (req.url === "/api/v1/businesses/me") return json(200, { name: "E2E Office Ltd" });
    if (req.url === "/api/v1/documents" && req.method === "POST") {
      const n = 50000 + docs.length + 1;
      docs.push({ n, body });
      return json(200, { id: `doc-${n}`, number: n, url: { origin: `http://localhost:${PORT}/api/v1/download/${n}` } });
    }
    json(404, { errorMessage: "not found" });
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

(async () => {
  await new Promise((r) => fake.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  let admin;
  try {
    // ---- 1. Admin connects Green Invoice ----
    admin = await signIn(browser, "admin@example.com");
    watch(admin);
    await admin.goto(BASE + "/admin/settings?tab=integrations");
    await settle(admin);
    const card = admin.locator("div.rounded-xl", { has: admin.getByRole("heading", { name: "קבלות וחשבוניות" }) }).first();
    await card.getByText("לא מחובר", { exact: true }).waitFor();
    await card.locator("button:has-text('חיבור שירות חשבוניות')").click();
    await card.getByLabel("מזהה מפתח (API key ID)").fill(KEY.id);
    await card.getByLabel("סוד (Secret)").fill("wrong-secret-0000");
    await axe(admin, "invoices connect form");
    await card.locator("button:has-text('בדיקה ושמירה')").click();
    await admin.locator("[role=alert]", { hasText: "שירות החשבוניות לא אישר את המפתחות" }).first().waitFor();
    await card.getByLabel("סוד (Secret)").fill(KEY.secret);
    await card.locator("button:has-text('בדיקה ושמירה')").click();
    await admin.locator("[role=status]", { hasText: "שירות החשבוניות חובר" }).first().waitFor();
    await settle(admin);
    await card.getByText("E2E Office Ltd").waitFor();
    await card.getByText("מחובר (סביבת בדיקות)", { exact: true }).waitFor();
    assert.equal(await admin.locator(`text=${KEY.secret}`).count(), 0, "the secret is never shown");
    await admin.screenshot({ path: OUT + "/settings.png", fullPage: true });
    log("admin connected Green Invoice; a wrong secret was refused");

    // ---- 2. A client pays a quote ----
    const api = (page, method, url, data) => page.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    const created = await api(admin, "POST", "/api/admin/cases", { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title: `קבלה ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" });
    const caseId = created.json.data.id;
    const quoteId = (await api(admin, "POST", `/api/cases/${caseId}/quotes`, {})).json.data.id;
    assert.equal((await api(admin, "PATCH", `/api/quotes/${quoteId}`, { serviceName: "ייעוץ", scope: "ייעוץ", included: "", excluded: "", currency: "ILS", taxRate: 18, pricesIncludeTax: false, paymentTerms: "", timeline: "", terms: "", validUntil: null, items: [{ description: "שעת ייעוץ", quantity: 1, unitPriceCents: 50000 }] })).status, 200);
    assert.equal((await api(admin, "POST", `/api/quotes/${quoteId}/send`, {})).status, 200);
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(client);
    assert.equal((await api(client, "POST", `/api/quotes/${quoteId}/approve`, { confirm: true, signature: { name: "נועם ישראלי" } })).status, 200);
    const checkout = await api(client, "POST", "/api/payments/checkout", { quoteId });
    const paymentId = checkout.json.data.paymentId;
    assert.equal((await api(client, "POST", `/api/payments/mock/${paymentId}`, { outcome: "succeeded" })).status, 200);
    const issued = await waitFor(() => docs.find((x) => x.body.reference === paymentId), "the document at Green Invoice");
    assert.equal(issued.body.type, 320);
    assert.equal(issued.body.income[0].price, 590);
    log(`payment of 590 ₪ issued tax invoice-receipt ${issued.n}`);

    // The client finds it in the documents.
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=documents`);
    await settle(client);
    const row = client.locator("li", { hasText: `חשבונית מס קבלה ${issued.n}` }).first();
    await row.waitFor();
    const pdf = await (await client.request.get(BASE + (await row.locator("a:has-text('הורדה')").getAttribute("href")))).body();
    assert.ok(pdf.equals(PDF), "the PDF from Green Invoice");
    log("the client has the PDF in the case's documents");

    // The Payments page shows it.
    await admin.goto(BASE + "/admin/payments");
    await settle(admin);
    await admin.locator("td a", { hasText: String(issued.n) }).first().waitFor();
    await axe(admin, "payments page with documents");
    log("the Payments page shows the document number");

    // ---- 3. The case is completed; the client rates it ----
    assert.equal((await api(admin, "PATCH", `/api/cases/${caseId}/status`, { status: "completed" })).status, 200);
    await client.goto(`${BASE}/portal/cases/${caseId}`);
    await settle(client);
    const fb = client.locator("#feedback");
    await fb.getByRole("heading", { name: "איך היה הטיפול?" }).waitFor();
    await axe(client, "feedback card");
    await fb.locator("label", { hasText: "4 מתוך 5" }).click();
    await fb.getByText("טוב", { exact: true }).waitFor();
    await fb.getByLabel("רוצה להוסיף משהו? (לא חובה)").fill("שירות מהיר ואדיב");
    await client.screenshot({ path: OUT + "/feedback.png", fullPage: true });
    await fb.locator("button:has-text('שליחת הדירוג')").click();
    await client.locator("[role=status]", { hasText: "תודה על הדירוג!" }).first().waitFor();
    await settle(client);
    await fb.getByText("הדירוג שלך: 4 מתוך 5").waitFor();
    log("the client rated the case 4 of 5");

    await admin.goto(`${BASE}/admin/cases/${caseId}`);
    await settle(admin);
    await admin.getByText("שירות מהיר ואדיב").first().waitFor();
    await admin.goto(`${BASE}/admin/reports`);
    await settle(admin);
    await admin.getByRole("heading", { name: "שביעות רצון לקוחות" }).waitFor();
    await admin.getByText("שירות מהיר ואדיב").first().waitFor();
    log("staff see the rating on the case and in the reports");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nINVOICES & FEEDBACK: all passed");
  } finally {
    // Leave the server as other scripts expect it: no invoicing service connected.
    if (admin) await admin.request.fetch(BASE + "/api/admin/invoices", { method: "DELETE" }).catch(() => {});
    await browser.close();
    fake.close();
  }
})().catch((e) => {
  console.error("INVOICES FAILED:", e);
  process.exit(1);
});
