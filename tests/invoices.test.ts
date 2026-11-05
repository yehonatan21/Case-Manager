import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { approveQuote } from "@/lib/services/quotes";
import { completeMockPayment, createCheckout } from "@/lib/services/payments";
import { connectInvoices, disconnectInvoices, dispatchPendingInvoices, getInvoiceStatus, issueInvoiceManually } from "@/lib/services/invoices";
import { _resetGreenInvoiceTokens } from "@/lib/invoicing/greeninvoice";
import { runJobs } from "@/lib/services/jobs";
import { caseWithSentQuote, expectCode, getAdmin, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
const KEY = { id: "key-id-123456", secret: "secret-abcdef-987654" };
const PDF = Buffer.from("%PDF-1.4 tax invoice from green invoice");

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  Object.assign(env, { invoiceApiUrl: "https://gi.test/api/v1" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetGreenInvoiceTokens();
});

/** A stand-in for Green Invoice's API: token, business, documents, PDF download. */
function fakeGreenInvoice(opts: { fail?: "auth" | "document" | "outage" } = {}) {
  const calls: { url: string; method: string; body: any; auth: string | null }[] = [];
  let seq = 1000;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init?.method ?? "GET", body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      if (url.endsWith("/account/token")) {
        if (opts.fail === "auth" || body?.id !== KEY.id || body?.secret !== KEY.secret) return Response.json({ errorCode: 401, errorMessage: "Invalid credentials" }, { status: 401 });
        return Response.json({ token: "jwt-token", expires: Math.floor(Date.now() / 1000) + 3600 });
      }
      if (url.endsWith("/businesses/me")) return Response.json({ name: "משרד לוי בע״מ" });
      if (url.endsWith("/documents") && init?.method === "POST") {
        if (opts.fail === "outage") return Response.json({ errorMessage: "Service unavailable" }, { status: 503 });
        if (opts.fail === "document") return Response.json({ errorCode: 2400, errorMessage: "Client name is required" }, { status: 400 });
        const n = ++seq;
        return Response.json({ id: `doc-${n}`, number: n, url: { origin: `https://www.greeninvoice.co.il/api/v1/documents/download?d=${n}`, he: `https://app.greeninvoice.co.il/d/${n}` } });
      }
      if (url.startsWith("https://www.greeninvoice.co.il/api/v1/documents/download")) return new Response(PDF, { headers: { "content-type": "application/pdf" } });
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

/** A client who approved a quote and paid it through the test checkout. */
async function paidCase(locale: "he" | "en" = "he") {
  const client = await makeUser(db, "customer", { locale });
  const { c, quoteId } = await caseWithSentQuote(db, client);
  await approveQuote(db, client, quoteId, null);
  const { paymentId } = await createCheckout(db, client, quoteId);
  await completeMockPayment(db, client, paymentId, "succeeded");
  return { client, c, quoteId, paymentId };
}
const invoiceOf = async (paymentId: string) => (await db.select().from(s.invoices).where(eq(s.invoices.paymentId, paymentId)))[0];

describe("without an invoicing service", () => {
  it("a successful payment gets the app's own payment confirmation (not a tax document), saved to the case", async () => {
    const { client, c, paymentId } = await paidCase();
    expect(await invoiceOf(paymentId)).toMatchObject({ provider: "confirmation", status: "pending" });
    expect(await dispatchPendingInvoices(db)).toBeGreaterThanOrEqual(1);
    const inv = await invoiceOf(paymentId);
    expect(inv).toMatchObject({ status: "issued", provider: "confirmation" });
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.id, inv!.documentId!));
    expect(doc).toMatchObject({ caseId: c.id, visibility: "client", title: `אישור תשלום ${inv!.number}` });
    const [f] = await db.select().from(s.documentFiles).where(eq(s.documentFiles.documentId, doc!.id));
    expect((await PDFDocument.load(await storage().get(f!.storageKey))).getPageCount()).toBe(1);
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, client.id), eq(s.notifications.type, "receipt_ready")));
    expect(notes.length).toBeGreaterThan(0);
    // One document per payment.
    await expectCode(issueInvoiceManually(db, admin, paymentId), "conflict");
  });
});

describe("Green Invoice", () => {
  it("only an admin connects, the keys are checked and stored encrypted; only hints are shown", async () => {
    fakeGreenInvoice();
    const input = { provider: "greeninvoice" as const, apiKeyId: KEY.id, apiSecret: KEY.secret, sandbox: true, documentType: "320" as const, autoIssue: true, emailClient: true };
    await expectCode(connectInvoices(db, await makeUser(db, "finance"), input), "forbidden");
    await expectCode(connectInvoices(db, admin, { ...input, apiSecret: "wrong-secret-xyz" }), "invoices_refused");
    await expectCode(connectInvoices(db, admin, { ...input, apiKeyId: "bad key!" }), "validation");
    await connectInvoices(db, admin, input);
    const st = await getInvoiceStatus(db);
    expect(st).toMatchObject({ connected: true, provider: "greeninvoice", sandbox: true, businessName: "משרד לוי בע״מ", apiKeyIdHint: "••••3456", documentType: "320" });
    expect(JSON.stringify(st)).not.toContain(KEY.secret);
    const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "integrations.invoices"));
    expect(JSON.stringify(row!.value)).not.toContain(KEY.secret);
    // Re-saving settings without retyping the secret keeps the stored keys.
    await connectInvoices(db, admin, { ...input, apiKeyId: "", apiSecret: "", documentType: "400" });
    expect((await getInvoiceStatus(db)).documentType).toBe("400");
    await connectInvoices(db, admin, input);
  });

  it("a payment issues a tax invoice-receipt for the amount paid, emailed by the service, with its PDF in the case", async () => {
    const calls = fakeGreenInvoice();
    const { client, c, paymentId } = await paidCase();
    await dispatchPendingInvoices(db);
    const inv = await invoiceOf(paymentId);
    expect(inv).toMatchObject({ provider: "greeninvoice", documentType: "320", status: "issued", externalId: expect.stringMatching(/^doc-/) });
    const created = calls.find((x) => x.url.endsWith("/documents"))!;
    expect(created.auth).toBe("Bearer jwt-token");
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
    expect(created.body).toMatchObject({ type: 320, currency: "ILS", lang: "he", reference: paymentId, client: { name: client.name, emails: [client.email], add: false } });
    expect(created.body.income).toEqual([expect.objectContaining({ quantity: 1, price: pay!.amountCents / 100, vatType: 1 })]);
    expect(created.body.payment).toEqual([expect.objectContaining({ type: 3, price: pay!.amountCents / 100 })]);
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.id, inv!.documentId!));
    expect(doc).toMatchObject({ caseId: c.id, title: `חשבונית מס קבלה ${inv!.number}` });
    const [f] = await db.select().from(s.documentFiles).where(eq(s.documentFiles.documentId, doc!.id));
    expect((await storage().get(f!.storageKey)).equals(PDF)).toBe(true);
  });

  it("temporary outages are retried; a refusal fails, tells finance, and can be retried by hand", async () => {
    fakeGreenInvoice({ fail: "outage" });
    const { paymentId } = await paidCase("en");
    await dispatchPendingInvoices(db);
    expect(await invoiceOf(paymentId)).toMatchObject({ status: "pending", attempts: 1 });
    vi.unstubAllGlobals();
    fakeGreenInvoice({ fail: "document" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await dispatchPendingInvoices(db);
    spy.mockRestore();
    const failed = await invoiceOf(paymentId);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed!.error).toContain("Client name is required");
    const finance = await makeUser(db, "finance");
    expect((await db.select().from(s.notifications).where(and(eq(s.notifications.userId, admin.id), eq(s.notifications.type, "receipt_failed")))).length).toBeGreaterThan(0);
    // Fixed at Green Invoice: retry from the Payments page.
    vi.unstubAllGlobals();
    fakeGreenInvoice();
    await expectCode(issueInvoiceManually(db, await makeUser(db, "case_manager"), paymentId), "forbidden");
    const retried = await issueInvoiceManually(db, finance, paymentId);
    expect(retried).toMatchObject({ status: "issued", error: null });
    expect((await db.select().from(s.documents).where(eq(s.documents.id, retried.documentId!))).length).toBe(1);
  });

  it("with automatic issuing off nothing is queued, and staff issue the document by hand", async () => {
    fakeGreenInvoice();
    await connectInvoices(db, admin, { provider: "greeninvoice", apiKeyId: "", apiSecret: "", sandbox: true, documentType: "400", autoIssue: false, emailClient: false });
    const { paymentId } = await paidCase();
    expect(await invoiceOf(paymentId)).toBeUndefined();
    const inv = await issueInvoiceManually(db, admin, paymentId);
    expect(inv).toMatchObject({ status: "issued", documentType: "400" });
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.id, inv.documentId!));
    expect(doc!.title).toBe(`קבלה ${inv.number}`);
    // Not emailed by the service this time.
    await connectInvoices(db, admin, { provider: "greeninvoice", apiKeyId: "", apiSecret: "", sandbox: true, documentType: "320", autoIssue: true, emailClient: true });
  });

  it("the jobs pick up anything left, and disconnecting falls back to payment confirmations", async () => {
    fakeGreenInvoice();
    const { paymentId } = await paidCase();
    expect((await runJobs(db)).invoicesIssued).toBeGreaterThanOrEqual(1);
    expect((await invoiceOf(paymentId))!.status).toBe("issued");
    await expectCode(disconnectInvoices(db, await makeUser(db, "finance")), "forbidden");
    await disconnectInvoices(db, admin);
    const next = await paidCase();
    expect((await invoiceOf(next.paymentId))!.provider).toBe("confirmation");
  });

  it("a PDF link to an unexpected host isn't fetched; the document still counts as issued with its link", async () => {
    fakeGreenInvoice();
    await connectInvoices(db, admin, { provider: "greeninvoice", apiKeyId: KEY.id, apiSecret: KEY.secret, sandbox: true, documentType: "320", autoIssue: true, emailClient: true });
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/account/token")) return Response.json({ token: "t" });
        if (url.endsWith("/documents") && init?.method === "POST") return Response.json({ id: "doc-x", number: 77, url: { origin: "http://169.254.169.254/evil.pdf" } });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const { paymentId } = await paidCase();
    await dispatchPendingInvoices(db);
    expect(await invoiceOf(paymentId)).toMatchObject({ status: "issued", number: "77", documentId: null, url: "http://169.254.169.254/evil.pdf" });
  });
});
