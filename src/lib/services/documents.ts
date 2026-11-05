import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { documentFiles, documents, signatures, type User } from "../db/schema";
import { AppError } from "../errors";
import { sha256 } from "../crypto";
import { storage } from "../storage";
import { scanBuffer } from "../storage/scan";
import { safeFilename, validateUpload } from "../storage/validate";
import { statusAfterClientResponse, statusWhenRequestingFromClient } from "../domain";
import { applyStatus, adminCaseLink, caseWithAccess, portalCaseLink } from "./cases";
import { addEvent } from "./events";
import { notify, staffRecipients } from "./notifications";
import { audit } from "./audit";
import { canAccessIntake } from "./intake";
import { intakeSessions, users } from "../db/schema";
import { dictionaries } from "../i18n/dictionaries";
import type { Locale } from "../i18n/config";

type UploadFile = { name: string; data: Buffer };

/** Validate → scan → store encrypted. Infected files are rejected and audited. */
export async function storeFile(db: DbOrTx, actorId: string | null, file: UploadFile, scope: string) {
  const filename = safeFilename(file.name);
  const mimeType = validateUpload(filename, file.data);
  const scan = await scanBuffer(file.data);
  if (scan === "infected") {
    await audit(db, { actorId, action: "document.blocked_malware", entityType: "upload", details: { filename, scope } });
    throw new AppError("file_infected");
  }
  const hash = sha256(file.data);
  const key = `${scope}/${crypto.randomUUID()}`;
  await storage().put(key, file.data, mimeType);
  return { filename, mimeType, sizeBytes: file.data.length, sha256: hash, storageKey: key, scanStatus: scan };
}

export async function requestDocument(db: Database, actor: User, caseId: string, input: { title: string; note?: string | null }) {
  return db.transaction(async (tx) => {
    const { c, access, customerUserId } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit || !access.documents) throw new AppError("forbidden");
    const [d] = await tx
      .insert(documents)
      .values({ caseId: c.id, title: input.title.trim(), status: "requested", requestNote: input.note?.trim() || null, requestedById: actor.id, createdById: actor.id })
      .returning();
    await addEvent(tx, { caseId: c.id, type: "document_requested", actor, visibility: "client", data: { title: d!.title } });
    const to = statusWhenRequestingFromClient(c.status);
    if (to) await applyStatus(tx, c, to, actor, { notifyClient: false });
    await notify(tx, { userIds: [customerUserId], type: "document_requested", caseId: c.id, vars: { number: c.number, title: d!.title }, link: `${portalCaseLink(c.id)}?tab=documents` });
    return d!;
  });
}

export async function uploadCaseDocument(
  db: Database,
  actor: User,
  caseId: string,
  input: { file: UploadFile; documentId?: string | null; title?: string | null; visibility?: "client" | "internal" },
) {
  const { c, access, customerUserId } = await caseWithAccess(db, actor, caseId);
  if (!access.documents) throw new AppError("forbidden");
  if (!access.isClient && !access.edit) throw new AppError("forbidden");
  const stored = await storeFile(db, actor.id, input.file, `cases/${c.id}`);

  return db.transaction(async (tx) => {
    let doc;
    if (input.documentId) {
      const [existing] = await tx.select().from(documents).where(and(eq(documents.id, input.documentId), eq(documents.caseId, c.id)));
      if (!existing) throw new AppError("not_found");
      if (access.isClient && existing.visibility !== "client") throw new AppError("not_found");
      doc = existing;
    } else {
      const [created] = await tx
        .insert(documents)
        .values({
          caseId: c.id,
          title: (input.title?.trim() || stored.filename).slice(0, 200),
          status: "uploaded",
          visibility: access.isClient ? "client" : (input.visibility ?? "client"),
          createdById: actor.id,
        })
        .returning();
      doc = created!;
    }
    const version = doc.currentVersion + 1;
    const [file] = await tx.insert(documentFiles).values({ documentId: doc.id, version, uploadedById: actor.id, ...stored }).returning();
    const newStatus = access.isClient ? "uploaded" : doc.status === "requested" || doc.status === "needs_new_version" ? "uploaded" : doc.status;
    await tx.update(documents).set({ currentVersion: version, status: newStatus, updatedAt: new Date() }).where(eq(documents.id, doc.id));
    await addEvent(tx, { caseId: c.id, type: "document_uploaded", actor, visibility: doc.visibility, data: { title: doc.title, version } });
    await audit(tx, { actorId: actor.id, action: "document.upload", entityType: "document", entityId: doc.id, details: { fileId: file!.id, version } });

    if (access.isClient) {
      // Back to the team once nothing required is still waiting on the client (a checklist may ask for several).
      const [left] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(
          and(
            eq(documents.caseId, c.id),
            eq(documents.visibility, "client"),
            eq(documents.required, true),
            isNotNull(documents.requestedById),
            inArray(documents.status, ["requested", "needs_new_version"]),
          ),
        );
      const [unsigned] = await tx.select({ n: sql<number>`count(*)::int` }).from(signatures).where(and(eq(signatures.caseId, c.id), eq(signatures.status, "requested")));
      const back = (left?.n ?? 0) === 0 && (unsigned?.n ?? 0) === 0 ? statusAfterClientResponse(c.status) : null;
      if (back) await applyStatus(tx, c, back, actor, { notifyClient: false });
      await notify(tx, { userIds: await staffRecipients(tx, c), type: "document_uploaded", caseId: c.id, vars: { number: c.number, title: doc.title }, link: `${adminCaseLink(c.id)}?tab=documents` });
    } else if (doc.visibility === "client") {
      await notify(tx, { userIds: [customerUserId], type: "document_uploaded", caseId: c.id, vars: { number: c.number, title: doc.title }, link: `${portalCaseLink(c.id)}?tab=documents` });
    }
    return { document: doc, file: file! };
  });
}

export async function uploadIntakeAttachment(db: Database, opts: { sessionId: string; user: User | null; ownerToken: string | null; file: UploadFile }) {
  const [s] = await db.select().from(intakeSessions).where(eq(intakeSessions.id, opts.sessionId));
  if (!s || !canAccessIntake(s, opts.user, opts.ownerToken)) throw new AppError("not_found");
  if (s.status !== "active") throw new AppError("conflict");
  const existing = await db.select({ id: documents.id }).from(documents).where(eq(documents.intakeSessionId, s.id));
  if (existing.length >= 10) throw new AppError("rate_limited");
  const stored = await storeFile(db, opts.user?.id ?? null, opts.file, `intake/${s.id}`);
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ intakeSessionId: s.id, title: stored.filename, status: "uploaded", visibility: "client", createdById: opts.user?.id ?? null, currentVersion: 1 })
      .returning();
    const [file] = await tx.insert(documentFiles).values({ documentId: doc!.id, version: 1, uploadedById: opts.user?.id ?? null, ...stored }).returning();
    return { document: doc!, file: file! };
  });
}

export async function reviewDocument(
  db: Database,
  actor: User,
  documentId: string,
  input: { status: "in_review" | "approved" | "needs_new_version"; note?: string | null },
) {
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
    if (!doc?.caseId) throw new AppError("not_found");
    const { c, access, customerUserId } = await caseWithAccess(tx, actor, doc.caseId);
    if (!access.edit || !access.documents) throw new AppError("forbidden");
    await tx
      .update(documents)
      .set({
        status: input.status,
        reviewNote: input.status === "needs_new_version" ? input.note?.trim() || null : doc.reviewNote,
        // Asking for a new version starts a fresh reminder cycle.
        ...(input.status === "needs_new_version" ? { reminderCount: 0, lastRemindedAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));
    const clientVisible = doc.visibility === "client" && input.status !== "in_review";
    await addEvent(tx, {
      caseId: c.id,
      type: "document_reviewed",
      actor,
      visibility: clientVisible ? "client" : "internal",
      data: { title: doc.title, status: input.status },
    });
    if (input.status === "needs_new_version") {
      const to = statusWhenRequestingFromClient(c.status);
      if (to) await applyStatus(tx, c, to, actor, { notifyClient: false });
    }
    if (clientVisible) {
      const [cu] = await tx.select({ locale: users.locale }).from(users).where(eq(users.id, customerUserId));
      const loc = (cu?.locale as Locale) ?? "he";
      await notify(tx, {
        userIds: [customerUserId],
        type: "document_reviewed",
        caseId: c.id,
        vars: { number: c.number, title: doc.title, status: dictionaries[loc].documentStatus[input.status] },
        link: `${portalCaseLink(c.id)}?tab=documents`,
      });
    }
    await audit(tx, { actorId: actor.id, action: "document.review", entityType: "document", entityId: doc.id, details: input });
  });
}

/** Authorizes a download and returns the file and a backend URL if the store supports presigned links. */
export async function authorizeDownload(db: Database, user: User | null, ownerToken: string | null, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new AppError("not_found");
  const [row] = await db
    .select({ f: documentFiles, d: documents })
    .from(documentFiles)
    .innerJoin(documents, eq(documents.id, documentFiles.documentId))
    .where(eq(documentFiles.id, fileId));
  if (!row) throw new AppError("not_found");
  if (row.d.caseId) {
    if (!user) throw new AppError("unauthorized");
    const { access } = await caseWithAccess(db, user, row.d.caseId);
    if (!access.documents) throw new AppError("not_found");
    if (access.isClient && row.d.visibility !== "client") throw new AppError("not_found");
  } else if (row.d.intakeSessionId) {
    const [s] = await db.select().from(intakeSessions).where(eq(intakeSessions.id, row.d.intakeSessionId));
    if (!s || !canAccessIntake(s, user, ownerToken)) throw new AppError("not_found");
  } else {
    throw new AppError("not_found");
  }
  await audit(db, { actorId: user?.id ?? null, action: "document.download", entityType: "document_file", entityId: fileId, details: { documentId: row.d.id } });
  return row.f;
}

export async function latestFile(db: DbOrTx, documentId: string) {
  const [f] = await db.select().from(documentFiles).where(eq(documentFiles.documentId, documentId)).orderBy(desc(documentFiles.version)).limit(1);
  return f ?? null;
}
