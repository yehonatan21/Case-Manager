// Deleting an account: a new client opens Profile, reads what's deleted and what's kept, confirms with their email
// address, and ends on the confirmation page, signed out. Also the public page app stores link to.
//   BASE=http://localhost:3000 node e2e/account-deletion.cjs   (server in demo mode)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "account-deletion");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);

/** A new client, signed up through the real API; returns the session cookie. */
async function newClient(email) {
  const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
  const code = (await (await post("/api/auth/request-code", { email, purpose: "signup" })).json()).data.devCode;
  const res = await post("/api/auth/verify", { email, code, signup: { name: "Dana Levi", customerType: "private", acceptTerms: true, aiConsent: false } });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie").match(/cm_session=([^;]+)/)[1];
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  try {
    // ---- The public page, signed out ----
    const pub = await browser.newPage({ locale: "he-IL" });
    pub.on("pageerror", (e) => errors.push(e.message));
    await pub.goto(BASE + "/delete-account");
    await pub.getByRole("heading", { level: 1, name: "מחיקת החשבון" }).waitFor();
    await pub.getByText("מה נשמר").waitFor();
    assert.equal(await pub.getByRole("link", { name: "התחברות למחיקת החשבון" }).getAttribute("href"), "/login?next=%2Fdelete-account");
    assert.ok(await pub.locator('footer a[href="/delete-account"]').count(), "linked from the footer");
    await pub.close();
    log("the public page explains what's deleted and kept, and links to sign-in");

    // ---- A client deletes their account from Profile ----
    const email = `delete-e2e-${Date.now()}@example.com`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
    await ctx.addCookies([{ name: "cm_session", value: await newClient(email), url: BASE }]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/portal/profile");
    const card = page.locator("[data-delete-account]");
    await card.waitFor();
    await card.getByText("תשלומים, חשבוניות וקבלות").waitFor();
    await card.getByRole("button", { name: "מחיקת החשבון…" }).click();
    const dialog = page.getByRole("dialog", { name: "למחוק את החשבון?" });
    await dialog.waitFor();
    const confirm = dialog.getByRole("button", { name: "מחיקת החשבון לצמיתות" });
    assert.ok(await confirm.isDisabled(), "disabled until the email is typed");
    await dialog.getByLabel("כדי לאשר, הקלידו את כתובת האימייל שלך").fill("wrong@example.com");
    assert.ok(await confirm.isDisabled());
    await dialog.getByLabel("כדי לאשר, הקלידו את כתובת האימייל שלך").fill(email.toUpperCase());
    await page.screenshot({ path: OUT + "/confirm.png" });
    await confirm.click();
    await page.waitForURL((u) => new URL(u).pathname === "/delete-account" && new URL(u).searchParams.get("done") === "1", { timeout: 20000 });
    await page.getByRole("heading", { name: "החשבון נמחק" }).waitFor();
    await page.screenshot({ path: OUT + "/done.png" });
    log("deleted from Profile after typing the email; the confirmation page shows");

    await page.goto(BASE + "/portal");
    await page.waitForURL((u) => new URL(u).pathname.startsWith("/login"), { timeout: 15000 });
    log("signed out: the portal asks to sign in again");

    // ---- Staff see a note, not the button ----
    const staff = await browser.newContext({ locale: "he-IL" });
    const sp = await staff.newPage();
    await sp.goto(BASE + "/login?as=finance%40example.com");
    const code = (await sp.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
    await sp.fill('input[autocomplete="one-time-code"]', code);
    await sp.click("button[type=submit]");
    await sp.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
    await sp.goto(BASE + "/delete-account");
    await sp.getByText("חשבונות של אנשי צוות מושבתים").waitFor();
    assert.equal(await sp.locator("[data-delete-account]").count(), 0);
    await staff.close();
    log("a team member is told their account is disabled by an admin instead");

    // ---- An admin deletes a client's account at their request ----
    const other = `delete-admin-${Date.now()}@example.com`;
    await newClient(other);
    const adminCtx = await browser.newContext({ locale: "he-IL" });
    const ap = await adminCtx.newPage();
    ap.on("pageerror", (e) => errors.push(e.message));
    await ap.goto(BASE + "/login?as=admin%40example.com");
    const acode = (await ap.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
    await ap.fill('input[autocomplete="one-time-code"]', acode);
    await ap.click("button[type=submit]");
    await ap.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
    await ap.goto(`${BASE}/admin/customers?q=${encodeURIComponent(other)}`);
    await ap.locator('table a[href^="/admin/customers/"]').first().click();
    await ap.getByRole("button", { name: "מחיקת החשבון של הלקוח…" }).click();
    const adlg = ap.getByRole("dialog", { name: "למחוק את החשבון?" });
    await adlg.getByLabel("כדי לאשר, הקלידו את כתובת האימייל של הלקוח").fill(other);
    await adlg.getByRole("button", { name: "מחיקת החשבון לצמיתות" }).click();
    await ap.waitForURL((u) => new URL(u).pathname === "/admin/customers", { timeout: 20000 });
    await ap.locator("[role=status]", { hasText: "החשבון של הלקוח נמחק" }).first().waitFor();
    await ap.goto(`${BASE}/admin/customers?q=${encodeURIComponent(other)}`);
    assert.equal(await ap.locator('table a[href^="/admin/customers/"]').count(), 0, "the address no longer finds the client");
    await adminCtx.close();
    log("an admin deleted a client's account from the client's page");

    assert.deepEqual(errors, [], "no page errors");
    console.log("\nACCOUNT DELETION: all passed");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("ACCOUNT DELETION FAILED:", e);
  process.exit(1);
});
