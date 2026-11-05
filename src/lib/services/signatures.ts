/**
 * Electronic signatures.
 *
 * - Staff request a signature on a client-visible PDF document (the request is for the current file version).
 *   The client reviews it and signs by typing their full name, optionally drawing their signature, and agreeing to
 *   sign electronically. The app stores a new file version: the original stamped on every page, plus a certificate
 *   page with the evidence (signer, time, IP, device, method, the original's SHA-256).
 * - Approving a quote is a signature too: a signed PDF of the approved version is saved to the case's documents.
 *
 * This is an "electronic signature" under Israel's Electronic Signature Law, 5761-2001 (not a certified one).
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { customers, documentFiles, documents, quoteItems, signatures, users, type Quote, type User } from "../db/schema";
import { AppError } from "../errors";
import { sha256 } from "../crypto";
import { storage } from "../storage";
import { env } from "../env";
import { statusAfterClientResponse, statusWhenRequestingFromClient } from "../domain";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { signedQuotePdf, signPdf, UnsupportedPdfError, type QuoteForPdf } from "../pdf/signed";
import { applyStatus, adminCaseLink, caseWithAccess, getCaseRow, portalCaseLink } from "./cases";
import { addEvent } from "./events";
import { notify, staffRecipients } from "./notifications";
import { audit } from "./audit";
import { storeFile } from "./documents";
import { getSettings } from "./settings";

/** Drawn signatures are small PNGs; anything bigger is refused. */
export const MAX_SIGNATURE_IMAGE_BYTES = 300 * 1024;

export type SignInput = { name: string; image?: string | null; consent: boolean };
export type SignMeta = { ip: string | null; userAgent: string | null };

/** Full name as typed: 2–120 characters with at least two letters. */
export function validSignerName(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 120) return null;
  if ((n.match(/\p{L}/gu) ?? []).length < 2) return null;
  return n;
}

/** Decodes a drawn signature (data:image/png;base64,...). Returns null when none was drawn; throws when invalid. */
export function decodeSignatureImage(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError("validation", "Signature image must be a PNG data URL");
  const buf = Buffer.from(m[1]!, "base64");
  if (buf.length === 0 || buf.length > MAX_SIGNATURE_IMAGE_BYTES) throw new AppError("validation", "Signature image too large");
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new AppError("validation", "Not a PNG");
  return buf;
}

async function currentFile(db: DbOrTx, documentId: string, version: number) {
  const [f] = await db.select().from(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.version, version)));
  return f ?? null;
}

/** Staff: ask the client to sign a PDF document of the case. */
export async function requestSignature(db: Database, actor: User, caseId: string, documentId: string, note?: string | null) {
  return db.transaction(async (tx) => {
    const { c, access, customerUserId } = await caseWithAccess(tx, actor, caseId);
    if (access.isClient || !access.edit || !access.documents) throw new AppError("forbidden");
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.caseId, c.id)));
    if (!doc) throw new AppError("not_found");
    if (doc.visibility !== "client") throw new AppError("signature_not_pdf", "Only documents the client can see can be signed");
    const file = doc.currentVersion > 0 ? await currentFile(tx, doc.id, doc.currentVersion) : null;
    if (!file || file.mimeType !== "application/pdf") throw new AppError("signature_not_pdf");
    const [pending] = await tx.select({ id: signatures.id }).from(signatures).where(and(eq(signatures.documentId, doc.id), eq(signatures.status, "requested")));
    if (pending) throw new AppError("signature_already_requested");
    const [sig] = await tx
      .insert(signatures)
      .values({ caseId: c.id, documentId: doc.id, status: "requested", note: note?.trim().slice(0, 1000) || null, requestedById: actor.id, fileVersion: doc.currentVersion })
      .returning();
    await addEvent(tx, { caseId: c.id, type: "signature_requested", actor, visibility: "client", data: { title: doc.title } });
    const to = statusWhenRequestingFromClient(c.status);
    if (to) await applyStatus(tx, c, to, actor, { notifyClient: false });
    await notify(tx, { userIds: [customerUserId], type: "signature_requested", caseId: c.id, vars: { number: c.number, title: doc.title }, link: `${portalCaseLink(c.id)}?tab=documents` });
    await audit(tx, { actorId: actor.id, action: "signature.request", entityType: "document", entityId: doc.id, details: { signatureId: sig!.id, version: doc.currentVersion } });
    return sig!;
  });
}

/** Staff: withdraw a signature request that hasn't been signed. */
export async function cancelSignature(db: Database, actor: User, signatureId: string) {
  const [sig] = await db.select().from(signatures).where(eq(signatures.id, signatureId));
  if (!sig) throw new AppError("not_found");
  const { c, access } = await caseWithAccess(db, actor, sig.caseId);
  if (access.isClient || !access.edit) throw new AppError("forbidden");
  if (sig.status !== "requested") throw new AppError("conflict");
  await db.transaction(async (tx) => {
    await tx.update(signatures).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(signatures.id, sig.id), eq(signatures.status, "requested")));
    await addEvent(tx, { caseId: c.id, type: "signature_cancelled", actor, visibility: "internal" });
    await audit(tx, { actorId: actor.id, action: "signature.cancel", entityType: "signature", entityId: sig.id });
  });
}

/** Signature requests still waiting on the client in a case. */
async function pendingCount(db: DbOrTx, caseId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(signatures).where(and(eq(signatures.caseId, caseId), eq(signatures.status, "requested")));
  return r?.n ?? 0;
}

/** Required document requests still waiting on the client. */
async function outstandingRequiredDocs(db: DbOrTx, caseId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.caseId, caseId), eq(documents.visibility, "client"), eq(documents.required, true), isNotNull(documents.requestedById), inArray(documents.status, ["requested", "needs_new_version"])));
  return r?.n ?? 0;
}

const companyName = async (db: DbOrTx) => (await getSettings(db)).company.name || env.appName;

/** Client: sign a requested document. */
export async function signDocument(db: Database, actor: User, signatureId: string, input: SignInput, meta: SignMeta) {
  const [sig] = await db.select().from(signatures).where(eq(signatures.id, signatureId));
  if (!sig || !sig.documentId) throw new AppError("not_found");
  const { c, access } = await caseWithAccess(db, actor, sig.caseId);
  if (!access.isClient) throw new AppError("forbidden");
  if (sig.status !== "requested") throw new AppError("signature_not_pending");
  if (!input.consent) throw new AppError("validation", "Consent to sign electronically is required");
  const name = validSignerName(input.name);
  if (!name) throw new AppError("signature_name_invalid");
  const image = decodeSignatureImage(input.image);

  const [doc] = await db.select().from(documents).where(eq(documents.id, sig.documentId));
  if (!doc || doc.visibility !== "client") throw new AppError("not_found");
  // The request is for one exact version: a newer upload needs a new request.
  if (doc.currentVersion !== sig.fileVersion) throw new AppError("signature_outdated");
  const file = await currentFile(db, doc.id, doc.currentVersion);
  if (!file) throw new AppError("not_found");
  const original = await storage().get(file.storageKey);
  if (sha256(original) !== file.sha256) throw new AppError("server_error", "Stored file doesn't match its fingerprint");

  const signedAt = new Date();
  const locale = (actor.locale as Locale) ?? "he";
  let signed: Buffer;
  try {
    signed = await signPdf(
      original,
      {
        reference: sig.id,
        documentTitle: doc.title,
        caseNumber: c.number,
        company: await companyName(db),
        signerName: name,
        signerEmail: actor.email,
        method: image ? "drawn" : "typed",
        image,
        signedAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
        originalSha256: file.sha256,
      },
      locale,
    );
  } catch (err) {
    if (err instanceof UnsupportedPdfError) throw new AppError("signature_pdf_unsupported");
    throw err;
  }
  const base = file.filename.replace(/\.pdf$/i, "");
  const stored = await storeFile(db, actor.id, { name: `${base}${dictionaries[locale].signatures.signedSuffix}.pdf`, data: signed }, `cases/${c.id}`);

  return db.transaction(async (tx) => {
    const version = doc.currentVersion + 1;
    const [f] = await tx.insert(documentFiles).values({ documentId: doc.id, version, uploadedById: actor.id, ...stored }).returning();
    const [done] = await tx
      .update(signatures)
      .set({ status: "signed", signerId: actor.id, signerName: name, signerEmail: actor.email, method: image ? "drawn" : "typed", signedAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null, originalSha256: file.sha256, signedSha256: stored.sha256, signedFileId: f!.id })
      .where(and(eq(signatures.id, sig.id), eq(signatures.status, "requested")))
      .returning();
    // Signed twice at the same moment: the first one wins.
    if (!done) throw new AppError("signature_not_pending");
    await tx.update(documents).set({ currentVersion: version, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await addEvent(tx, { caseId: c.id, type: "document_signed", actor, visibility: "client", data: { title: doc.title, version } });
    await audit(tx, { actorId: actor.id, action: "signature.sign", entityType: "document", entityId: doc.id, ip: meta.ip, details: { signatureId: sig.id, originalSha256: file.sha256, signedSha256: stored.sha256, method: done.method } });
    if ((await pendingCount(tx, c.id)) === 0 && (await outstandingRequiredDocs(tx, c.id)) === 0) {
      const back = statusAfterClientResponse(c.status);
      if (back) await applyStatus(tx, await getCaseRow(tx, c.id), back, actor, { notifyClient: false });
    }
    await notify(tx, { userIds: await staffRecipients(tx, c), type: "document_signed", caseId: c.id, vars: { number: c.number, title: doc.title, name }, link: `${adminCaseLink(c.id)}?tab=documents` });
    return done;
  });
}

/**
 * After a client approves a quote: a signed PDF of the approved version, saved as a client-visible document of the
 * case, with a signature record. Failures are logged, not thrown (the approval itself already stands).
 */
export async function saveSignedQuote(db: Database, actor: User, quote: Quote, input: { name?: string | null; image?: string | null }, meta: SignMeta) {
  try {
    const c = await getCaseRow(db, quote.caseId);
    const locale = (actor.locale as Locale) ?? "he";
    const t = dictionaries[locale].signatures;
    const name = validSignerName(input.name ?? "") ?? actor.name;
    const image = decodeSignatureImage(input.image);
    const snap = (quote.sentSnapshot as QuoteForPdf | null) ?? null;
    const items = snap?.items ?? (await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quote.id)));
    const q: QuoteForPdf = snap ?? { ...quote, items };
    const [cust] = await db.select({ name: users.name }).from(customers).innerJoin(users, eq(users.id, customers.userId)).where(eq(customers.id, c.customerId));
    const signedAt = quote.approvedAt ?? new Date();
    const [sig] = await db.insert(signatures).values({ caseId: c.id, quoteId: quote.id, status: "requested", requestedById: null, fileVersion: null }).returning();
    const pdf = await signedQuotePdf(
      q,
      {
        reference: sig!.id,
        documentTitle: fmt(t.quoteDocTitle, { version: quote.version }),
        caseNumber: c.number,
        company: await companyName(db),
        customerName: cust?.name ?? actor.name,
        signerName: name,
        signerEmail: actor.email,
        method: image ? "drawn" : "typed",
        image,
        signedAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
        originalSha256: "",
      },
      locale,
    );
    const stored = await storeFile(db, actor.id, { name: `${t.quoteFileName}-${c.number}-v${quote.version}.pdf`, data: pdf.data }, `cases/${c.id}`);
    await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ caseId: c.id, title: fmt(t.quoteDocTitle, { version: quote.version }), status: "approved", visibility: "client", createdById: actor.id, currentVersion: 1 })
        .returning();
      const [f] = await tx.insert(documentFiles).values({ documentId: doc!.id, version: 1, uploadedById: actor.id, ...stored }).returning();
      await tx
        .update(signatures)
        .set({ documentId: doc!.id, status: "signed", fileVersion: 1, signerId: actor.id, signerName: name, signerEmail: actor.email, method: image ? "drawn" : "typed", signedAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null, originalSha256: pdf.originalSha256, signedSha256: stored.sha256, signedFileId: f!.id })
        .where(eq(signatures.id, sig!.id));
      await audit(tx, { actorId: actor.id, action: "signature.quote", entityType: "quote", entityId: quote.id, ip: meta.ip, details: { signatureId: sig!.id, signedSha256: stored.sha256 } });
    });
    return sig!.id;
  } catch (err) {
    console.error("[signatures] couldn't save the signed quote", err);
    return null;
  }
}

/** Signatures of a case, newest first (for the staff evidence view and tests). */
export async function listSignatures(db: DbOrTx, caseId: string) {
  return db.select().from(signatures).where(eq(signatures.caseId, caseId)).orderBy(desc(signatures.requestedAt));
}
