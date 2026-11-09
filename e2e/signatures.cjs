// Electronic signatures in the browser: staff upload a PDF and request a signature; the client gets a to-do,
// reviews the document, draws and types their signature, agrees and signs; the signed PDF (original + certificate
// page) replaces it as a new version and staff see the evidence. Then the client approves a quote with a
// signature and a signed quote PDF appears in the documents. axe runs on each new screen.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/signatures.cjs
const { chromium } = require("playwright");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "signatures");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(1000);

async function signIn(browser, email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "he", hasTouch: viewport.width < 600 });
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
async function pdfWithPages(n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) doc.addPage([595, 842]).drawText(`Power of attorney - page ${i + 1}`, { x: 50, y: 780, size: 16, font });
  return Buffer.from(await doc.save());
}
/** Draws a short stroke on the signature pad with the mouse. */
async function draw(page, canvas) {
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 20 + i * 15, b.y + b.height / 2 + (i % 2 ? -18 : 18), { steps: 2 });
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  try {
    // ---- 1. Staff upload a PDF for the client and request a signature ----
    const admin = await signIn(browser, "admin@example.com");
    watch(admin);
    const api = (method, url, data) => admin.request.fetch(BASE + url, { method, data, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status(), json: await r.json().catch(() => null) }));
    const created = await api("POST", "/api/admin/cases", { customer: { email: "client@example.com", name: "x", customerType: "private", locale: "he" }, title: `חתימה ${stamp}`, description: "בדיקה", serviceCategory: "other", urgency: "normal" });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const caseId = created.json.data.id;
    const up = await admin.request.fetch(`${BASE}/api/cases/${caseId}/documents`, {
      method: "POST",
      multipart: { file: { name: "poa.pdf", mimeType: "application/pdf", buffer: await pdfWithPages(2) }, title: "ייפוי כוח", visibility: "client" },
    });
    assert.equal(up.status(), 200);
    await admin.goto(`${BASE}/admin/cases/${caseId}?tab=documents`);
    await settle(admin);
    const row = admin.locator("li", { hasText: "ייפוי כוח" }).first();
    await row.locator("button:has-text('בקשת חתימה')").click();
    const dlg = admin.locator("dialog[open]");
    await dlg.waitFor();
    await dlg.getByLabel("הערה ללקוח (לא חובה)").fill("נא לחתום עד יום חמישי");
    await axe(admin, "request-signature dialog");
    await dlg.locator("button:has-text('שליחת בקשת חתימה')").click();
    await admin.locator("[role=status]", { hasText: "בקשת החתימה נשלחה ללקוח" }).first().waitFor();
    await settle(admin);
    await row.getByText("ממתין לחתימה").waitFor();
    assert.equal(await row.locator("button:has-text('בקשת חתימה')").count(), 0, "can't request twice");
    log("staff requested a signature on a 2-page PDF");

    // ---- 2. The client signs (mobile) ----
    const client = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(client);
    await client.goto(`${BASE}/portal/cases/${caseId}`);
    await settle(client);
    await client.getByText("חתימה על מסמך").first().waitFor();
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=documents`);
    await settle(client);
    // The document row (the to-do above also names the document).
    const crow = client.locator("li", { hasText: "ממתין לחתימתך" }).filter({ hasText: "ייפוי כוח" }).first();
    await crow.waitFor();
    await crow.getByText("נא לחתום עד יום חמישי").waitFor();
    await crow.getByRole("button", { name: "עיון וחתימה", exact: true }).click();
    const sdlg = client.locator("dialog[open]");
    await sdlg.waitFor();
    const signBtn = sdlg.locator("button:has-text('חתימה')").last();
    assert.equal(await signBtn.isDisabled(), true, "consent first");
    // The document opens for review in a new tab, inline.
    const open = sdlg.locator("a:has-text('פתיחת המסמך')");
    assert.match(await open.getAttribute("href"), /^\/api\/files\/[0-9a-f-]+\?inline=1$/);
    assert.equal(await open.getAttribute("target"), "_blank");
    const viewed = await client.request.get(BASE + (await open.getAttribute("href")));
    assert.equal(viewed.headers()["content-type"], "application/pdf");
    const name = sdlg.getByLabel("שם מלא");
    assert.notEqual(await name.inputValue(), "", "the name is prefilled");
    await name.fill("נועם ישראלי");
    await draw(client, sdlg.locator("canvas"));
    await sdlg.locator("[role=img][aria-label='החתימה צוירה']").waitFor();
    await sdlg.getByLabel("קראתי את המסמך ואני מסכים/ה לחתום עליו באופן אלקטרוני.").check();
    // The Sign button turns from disabled to enabled with a short color fade: check contrast once it's done.
    await client.waitForFunction((b) => b && !b.disabled, await signBtn.elementHandle());
    await client.waitForTimeout(500);
    await axe(client, "sign dialog");
    await client.screenshot({ path: OUT + "/sign-dialog.png" });
    await signBtn.click();
    await client.locator("[role=status]", { hasText: "המסמך נחתם" }).first().waitFor({ timeout: 20000 });
    await settle(client);
    const signedRow = client.locator("li", { hasText: "ייפוי כוח" }).first();
    await signedRow.getByText("נחתם על ידי נועם ישראלי").waitFor();
    await axe(client, "client documents after signing");
    await client.screenshot({ path: OUT + "/client-signed.png", fullPage: true });
    // The download is the signed version: the 2 original pages + the certificate.
    const href = await signedRow.locator("a:has-text('הורדה')").getAttribute("href");
    const signedPdf = await (await client.request.get(BASE + href)).body();
    assert.equal((await PDFDocument.load(signedPdf)).getPageCount(), 3);
    fs.writeFileSync(OUT + "/signed.pdf", signedPdf);
    log("client drew and typed a signature and signed; the signed PDF has the certificate page");

    // ---- 3. Staff see the evidence ----
    await admin.goto(`${BASE}/admin/cases/${caseId}?tab=documents`);
    await settle(admin);
    const srow = admin.locator("li", { hasText: "ייפוי כוח" }).first();
    await srow.getByText("נחתם", { exact: true }).waitFor();
    assert.equal(await srow.locator("button:has-text('בקשת חתימה')").count(), 0, "no new request on the signed copy");
    await srow.locator("summary:has-text('פרטי החתימה')").click();
    await srow.getByText("חתימה מצוירת ושם מוקלד").waitFor();
    assert.match(await srow.innerText(), /[0-9a-f]{64}/);
    await axe(admin, "staff documents with signature details");
    await admin.screenshot({ path: OUT + "/staff-evidence.png", fullPage: true });
    log("staff see the signature details (method, IP, device, fingerprints)");

    // ---- 4. Approving a quote is signed ----
    const q = await api("POST", `/api/cases/${caseId}/quotes`, {});
    const quoteId = q.json.data.id;
    assert.equal((await api("PATCH", `/api/quotes/${quoteId}`, { serviceName: "ליווי בחתימה", scope: "ליווי מלא", included: "", excluded: "", currency: "ILS", taxRate: 18, pricesIncludeTax: false, paymentTerms: "", timeline: "", terms: "", validUntil: null, items: [{ description: "שעת ייעוץ", quantity: 2, unitPriceCents: 40000 }] })).status, 200);
    assert.equal((await api("POST", `/api/quotes/${quoteId}/send`, {})).status, 200);
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=quote`);
    await settle(client);
    await client.getByRole("heading", { name: "החתימה שלך" }).waitFor();
    await client.getByLabel("שם מלא").fill("נועם ישראלי");
    await client.getByLabel(/אני מאשר/).check();
    await axe(client, "quote approval with signature");
    await client.locator("button:has-text('אישור הצעת המחיר')").click();
    await settle(client);
    await client.goto(`${BASE}/portal/cases/${caseId}?tab=documents`);
    await settle(client);
    const qrow = client.locator("li", { hasText: "הצעת מחיר חתומה (גרסה 1)" }).first();
    await qrow.waitFor();
    const qhref = await qrow.locator("a:has-text('הורדה')").getAttribute("href");
    const qpdf = await PDFDocument.load(await (await client.request.get(BASE + qhref)).body());
    assert.ok(qpdf.getPageCount() >= 2, "quote page(s) + certificate");
    log("approving the quote saved a signed quote PDF to the documents");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nSIGNATURES: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("SIGNATURES FAILED:", e);
  process.exit(1);
});
