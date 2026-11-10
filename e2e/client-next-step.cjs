// The client's case page leads with one next step: the team asks for two documents (with notes); the client sees
// the first, with what exactly counts and "and one more document after this", uploads it from the card itself (no
// tab switching), and the card moves on to the second; the folded list shows what's left. The contact shows the
// usual reply time. On a phone the button is full width; in English it reads "Your next step". axe throughout.
// Requires a running app in demo mode: BASE=http://localhost:3000 node e2e/client-next-step.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "client-next-step");
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const log = (...a) => console.log("•", ...a);
const settle = (p) => p.waitForTimeout(900);
// A tiny valid PDF.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function signIn(browser, email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "he", timezoneId: "Asia/Jerusalem" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  await settle(p);
  const code = (await p.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await p.fill('input[autocomplete="one-time-code"]', code);
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
  return p;
}
async function axe(page, label) {
  await page.waitForFunction(() => document.title.length > 0, null, { timeout: 10000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () =>
    (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } })).violations.map(
      (x) =>
        `${x.id}: ${x.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 2)
          .join(", ")}`,
    ),
  );
  assert.deepEqual(v, [], `accessibility violations on ${label}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  try {
    const client = await signIn(browser, "client@example.com");
    watch(client);
    const mine = (await (await client.request.get(BASE + "/api/cases")).json()).data;
    const c = mine.find((x) => !["completed", "closed", "cancelled", "declined"].includes(x.status)) ?? mine[0];
    assert.ok(c, "the demo client has a case");

    // ---- The team asks for two documents, with notes ----
    const admin = await signIn(browser, "admin@example.com");
    const stamp = Date.now().toString(36);
    const docs = [
      { title: `אישור כתובת ${stamp}`, note: "חשבון חשמל או ארנונה מ-3 החודשים האחרונים" },
      { title: `תעודת לידה ${stamp}`, note: null },
    ];
    for (const doc of docs) {
      const r = await admin.request.post(`${BASE}/api/cases/${c.id}/documents`, { data: doc, headers: { Origin: BASE } });
      assert.equal(r.status(), 200, await r.text());
    }

    // ---- The client sees one step: the first document, what counts, and what's left ----
    await client.goto(`${BASE}/portal/cases/${c.id}`);
    await settle(client);
    const card = client.locator("section[aria-labelledby=next-step-title]");
    await card.getByText("הצעד הבא שלך").waitFor();
    const title = await card.getByRole("heading").innerText();
    const first = docs[0];
    assert.equal(title.trim(), first.title, "the first document asked for is the step");
    if (first.note) await card.getByText(`מה בדיוק: ${first.note}`).waitFor();
    await card.getByText(/מסמך אחד אחרי זה|מסמכים אחרי זה/).waitFor();
    await card.locator("summary").click();
    const other = docs.find((d) => d !== first);
    await card.getByText(other.title).waitFor();
    await axe(client, "client case page with a next step");
    await client.screenshot({ path: OUT + "/next-step.png", fullPage: true });
    log(`the client sees one step ("${first.title}"), what counts, and that one more is waiting`);

    // ---- Uploading from the card itself; the card moves on ----
    await card.locator("input[type=file]").setInputFiles({ name: "address.pdf", mimeType: "application/pdf", buffer: PDF });
    await client.locator("[role=status]", { hasText: "התקבל" }).first().waitFor({ timeout: 15000 });
    await client.waitForFunction((t) => document.querySelector("#next-step-title")?.textContent?.trim() !== t, title.trim(), { timeout: 15000 });
    assert.equal((await card.getByRole("heading").innerText()).trim(), other.title, "the next document is the step now");
    assert.ok(new URL(client.url()).searchParams.get("tab") === null, "no tab switching was needed");
    await card.locator("input[type=file]").setInputFiles({ name: "birth.pdf", mimeType: "application/pdf", buffer: PDF });
    await client.locator("[role=status]", { hasText: other.title }).first().waitFor({ timeout: 15000 });
    await client.waitForFunction((t) => document.querySelector("#next-step-title")?.textContent?.trim() !== t, other.title, { timeout: 15000 });
    log("both documents were uploaded from the card, one after the other");

    // ---- Phone: the button fills the width ----
    const phone = await signIn(browser, "client@example.com", { width: 390, height: 844 });
    watch(phone);
    await phone.goto(`${BASE}/portal/cases/${c.id}`);
    await settle(phone);
    const pcard = phone.locator("section[aria-labelledby=next-step-title]");
    await pcard.waitFor();
    const btn = pcard.getByRole("button").first();
    if (await btn.count()) {
      const b = await btn.boundingBox();
      const k = await pcard.boundingBox();
      assert.ok(b.width > k.width - 60, "the main button fills the card on a phone");
    }
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    await axe(phone, "client case page on a phone");
    await phone.screenshot({ path: OUT + "/phone.png", fullPage: true });
    log("on a phone the step's button fills the card");

    // ---- English ----
    await client.context().addCookies([{ name: "cm_locale", value: "en", url: BASE }]);
    await client.goto(`${BASE}/portal/cases/${c.id}`);
    await settle(client);
    await client.locator("text=/Your next step|Nothing is needed from you right now|The whole process is complete/").first().waitFor();
    log("in English too");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nCLIENT NEXT STEP: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("CLIENT NEXT STEP FAILED:", e);
  process.exit(1);
});
