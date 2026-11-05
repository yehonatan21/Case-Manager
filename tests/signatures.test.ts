import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import { visualOrder } from "@/lib/pdf/text";
import { signPdf } from "@/lib/pdf/signed";
import { uploadCaseDocument } from "@/lib/services/documents";
import { assignCase, getCaseBundle, getCaseRow, listCustomerCases } from "@/lib/services/cases";
import { approveQuote } from "@/lib/services/quotes";
import { cancelSignature, decodeSignatureImage, listSignatures, requestSignature, saveSignedQuote, signDocument, validSignerName } from "@/lib/services/signatures";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User, manager: s.User;
const meta = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Test) Vitest" };

/** A real two-page PDF, like a power of attorney the office uploads. */
async function realPdf(pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Power of attorney, page ${i + 1}`, { x: 50, y: 780, size: 14, font });
  return Buffer.from(await doc.save());
}
/** A 1×1 PNG, as the browser's signature pad would send. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
});

/** A case of a fresh client, assigned to the manager, with a PDF the office uploaded for the client. */
async function caseWithPdf(opts: { pages?: number; data?: Buffer; name?: string } = {}) {
  const client = await makeUser(db, "customer", { locale: "he" });
  const c = await makeCase(db, client, "Power of attorney");
  await assignCase(db, admin, c.id, manager.id);
  const { document } = await uploadCaseDocument(db, manager, c.id, { file: { name: opts.name ?? "poa.pdf", data: opts.data ?? (await realPdf(opts.pages)) }, title: "ייפוי כוח", visibility: "client" });
  return { client, c, doc: document };
}
const fileOf = async (documentId: string, version: number) => (await db.select().from(s.documentFiles).where(and(eq(s.documentFiles.documentId, documentId), eq(s.documentFiles.version, version))))[0]!;

describe("signature input", () => {
  it("needs a real full name", () => {
    expect(validSignerName("  נועם   ישראלי ")).toBe("נועם ישראלי");
    expect(validSignerName("Jo")).toBe("Jo");
    expect(validSignerName("x")).toBeNull();
    expect(validSignerName("12345")).toBeNull();
    expect(validSignerName("a".repeat(121))).toBeNull();
  });

  it("accepts only small PNG data URLs as a drawn signature", () => {
    expect(decodeSignatureImage(null)).toBeNull();
    expect(decodeSignatureImage(PNG)!.subarray(1, 4).toString()).toBe("PNG");
    for (const bad of ["data:image/jpeg;base64,/9j/4AAQ", "data:image/png;base64,AAAA", "javascript:alert(1)", `data:image/png;base64,${Buffer.alloc(400_000).toString("base64")}`]) {
      expect(() => decodeSignatureImage(bad)).toThrow();
    }
  });

  it("puts Hebrew, numbers and brackets in visual order for the PDF", () => {
    expect(visualOrder("שלום", "rtl")).toBe("םולש");
    expect(visualOrder("תיק CASE-2026-0001", "rtl")).toBe("CASE-2026-0001 קית");
    expect(visualOrder("נועם (ID 12)", "rtl")).toBe("(ID 12) םעונ");
    expect(visualOrder("Signed by נועם", "ltr")).toBe("Signed by םעונ");
  });
});

describe("requesting a signature", () => {
  it("only staff can ask, only on a client-visible PDF, and only once at a time", async () => {
    const { client, c, doc } = await caseWithPdf();
    await expectCode(requestSignature(db, client, c.id, doc.id), "forbidden");
    const png = await uploadCaseDocument(db, manager, c.id, { file: { name: "x.png", data: Buffer.from(PNG.split(",")[1]!, "base64") }, visibility: "client" });
    await expectCode(requestSignature(db, manager, c.id, png.document.id), "signature_not_pdf");
    const internal = await uploadCaseDocument(db, manager, c.id, { file: { name: "i.pdf", data: await realPdf(1) }, visibility: "internal" });
    await expectCode(requestSignature(db, manager, c.id, internal.document.id), "signature_not_pdf");

    await requestSignature(db, manager, c.id, doc.id, "נא לחתום בהקדם");
    await expectCode(requestSignature(db, manager, c.id, doc.id), "signature_already_requested");
    // The client is told, has a to-do, and the case waits for them.
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, client.id), eq(s.notifications.type, "signature_requested")));
    expect(notes.length).toBeGreaterThan(0);
    const b = await getCaseBundle(db, client, c.id);
    expect(b.actions).toContainEqual({ type: "sign", count: 1, documentId: doc.id, title: "ייפוי כוח" });
    expect((await listCustomerCases(db, client))[0]!.actions.some((a) => a.type === "sign")).toBe(true);
    expect(b.signatures[0]).toMatchObject({ status: "requested", note: "נא לחתום בהקדם", ip: null });
    expect((await getCaseRow(db, c.id)).status).toBe("awaiting_information");
  });
});

describe("signing", () => {
  it("stores a stamped copy with a certificate page, and records the evidence", async () => {
    const { client, c, doc } = await caseWithPdf({ pages: 2 });
    const sig = await requestSignature(db, manager, c.id, doc.id);
    const original = await fileOf(doc.id, 1);

    await expectCode(signDocument(db, manager, sig.id, { name: "Dana", consent: true }, meta), "forbidden");
    await expectCode(signDocument(db, client, sig.id, { name: "נועם ישראלי", consent: false }, meta), "validation");
    await expectCode(signDocument(db, client, sig.id, { name: "1", consent: true }, meta), "signature_name_invalid");

    const done = await signDocument(db, client, sig.id, { name: "נועם ישראלי", consent: true }, meta);
    expect(done).toMatchObject({ status: "signed", signerName: "נועם ישראלי", signerEmail: client.email, method: "typed", ip: meta.ip, userAgent: meta.userAgent, originalSha256: original.sha256 });

    const signed = await fileOf(doc.id, 2);
    expect(signed.mimeType).toBe("application/pdf");
    expect(signed.filename).toBe("poa-חתום.pdf");
    expect(done.signedSha256).toBe(signed.sha256);
    expect(done.signedFileId).toBe(signed.id);
    const bytes = await storage().get(signed.storageKey);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(signed.sha256);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3); // 2 original pages + the certificate
    // The original file version is kept untouched.
    expect(crypto.createHash("sha256").update(await storage().get(original.storageKey)).digest("hex")).toBe(original.sha256);

    // Signing again, or after cancelling, isn't possible.
    await expectCode(signDocument(db, client, sig.id, { name: "נועם ישראלי", consent: true }, meta), "signature_not_pending");
    await expectCode(cancelSignature(db, manager, sig.id), "conflict");
    // The team is told, the case goes back to them, and the client's to-do is gone.
    const staff = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, manager.id), eq(s.notifications.caseId, c.id), eq(s.notifications.type, "document_signed")));
    expect(staff.length).toBeGreaterThan(0);
    expect((await getCaseRow(db, c.id)).status).toBe("under_review");
    expect((await getCaseBundle(db, client, c.id)).actions.some((a) => a.type === "sign")).toBe(false);
    // Staff see the evidence; the client doesn't see the IP or device.
    expect((await getCaseBundle(db, manager, c.id)).signatures[0]).toMatchObject({ ip: meta.ip, userAgent: meta.userAgent });
    expect((await getCaseBundle(db, client, c.id)).signatures[0]).toMatchObject({ ip: null, userAgent: null, signerName: "נועם ישראלי" });
  });

  it("a drawn signature is added to the certificate", async () => {
    const { client, c, doc } = await caseWithPdf({ pages: 1 });
    const sig = await requestSignature(db, manager, c.id, doc.id);
    const done = await signDocument(db, client, sig.id, { name: "Noam Israeli", image: PNG, consent: true }, meta);
    expect(done.method).toBe("drawn");
    expect((await PDFDocument.load(await storage().get((await fileOf(doc.id, 2)).storageKey))).getPageCount()).toBe(2);
  });

  it("a request is for one exact version: a newer upload makes it outdated", async () => {
    const { client, c, doc } = await caseWithPdf();
    const sig = await requestSignature(db, manager, c.id, doc.id);
    await uploadCaseDocument(db, manager, c.id, { file: { name: "poa-v2.pdf", data: await realPdf(1) }, documentId: doc.id });
    await expectCode(signDocument(db, client, sig.id, { name: "נועם ישראלי", consent: true }, meta), "signature_outdated");
  });

  it("a PDF that can't be read is refused without saving anything", async () => {
    const { client, c, doc } = await caseWithPdf({ data: Buffer.from("%PDF-1.4 not really a pdf") });
    const sig = await requestSignature(db, manager, c.id, doc.id);
    await expectCode(signDocument(db, client, sig.id, { name: "נועם ישראלי", consent: true }, meta), "signature_pdf_unsupported");
    expect((await db.select().from(s.documents).where(eq(s.documents.id, doc.id)))[0]!.currentVersion).toBe(1);
    expect((await listSignatures(db, c.id))[0]!.status).toBe("requested");
  });

  it("staff can cancel a request; the client can't sign it then", async () => {
    const { client, c, doc } = await caseWithPdf();
    const sig = await requestSignature(db, manager, c.id, doc.id);
    await expectCode(cancelSignature(db, client, sig.id), "forbidden");
    await cancelSignature(db, manager, sig.id);
    await expectCode(signDocument(db, client, sig.id, { name: "נועם ישראלי", consent: true }, meta), "signature_not_pending");
    expect((await getCaseBundle(db, client, c.id)).signatures).toHaveLength(0);
    // A new request can be made after cancelling.
    await requestSignature(db, manager, c.id, doc.id);
  });

  it("a client of another case can't sign", async () => {
    const { c, doc } = await caseWithPdf();
    const sig = await requestSignature(db, manager, c.id, doc.id);
    const stranger = await makeUser(db, "customer");
    await expectCode(signDocument(db, stranger, sig.id, { name: "Someone Else", consent: true }, meta), "not_found");
  });

  it("the stamp and certificate work for English and for many pages", async () => {
    const out = await signPdf(
      await realPdf(5),
      { reference: crypto.randomUUID(), documentTitle: "Engagement letter (v2)", caseNumber: "CASE-2026-0001", company: "Acme", signerName: "Dana Levi", signerEmail: "dana@example.com", method: "typed", image: null, signedAt: new Date(), ip: null, userAgent: null, originalSha256: "ab".repeat(32) },
      "en",
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(6);
  });
});

describe("signed quote approval", () => {
  it("approving a quote saves a signed PDF of that version to the case's documents", async () => {
    const client = await makeUser(db, "customer", { locale: "he" });
    const { c, quoteId } = await caseWithSentQuote(db, client);
    const q = await approveQuote(db, client, quoteId, meta.ip);
    const sigId = await saveSignedQuote(db, client, q, { name: "נועם ישראלי", image: PNG }, meta);
    expect(sigId).toBeTruthy();
    const [sig] = await db.select().from(s.signatures).where(eq(s.signatures.id, sigId!));
    expect(sig).toMatchObject({ status: "signed", quoteId, signerName: "נועם ישראלי", method: "drawn", ip: meta.ip });
    const [doc] = await db.select().from(s.documents).where(eq(s.documents.id, sig!.documentId!));
    expect(doc).toMatchObject({ caseId: c.id, title: "הצעת מחיר חתומה (גרסה 1)", visibility: "client", currentVersion: 1 });
    const f = await fileOf(doc!.id, 1);
    expect(f.sha256).toBe(sig!.signedSha256);
    const pdf = await PDFDocument.load(await storage().get(f.storageKey));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2); // the quote + the certificate
    expect(sig!.originalSha256).toMatch(/^[0-9a-f]{64}$/);
    // The client sees it among the documents.
    expect((await getCaseBundle(db, client, c.id)).documents.map((d) => d.title)).toContain("הצעת מחיר חתומה (גרסה 1)");
  });

  it("without a typed name the account name is used", async () => {
    const client = await makeUser(db, "customer", { locale: "en" });
    const { quoteId } = await caseWithSentQuote(db, client);
    const q = await approveQuote(db, client, quoteId, null);
    const sigId = await saveSignedQuote(db, client, q, {}, { ip: null, userAgent: null });
    const [sig] = await db.select().from(s.signatures).where(eq(s.signatures.id, sigId!));
    expect(sig).toMatchObject({ signerName: client.name, method: "typed" });
  });
});
