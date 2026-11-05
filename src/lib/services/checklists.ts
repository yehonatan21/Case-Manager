/**
 * Document checklists: a service template lists the documents a case usually needs; staff request the whole
 * list at once (one notification, one timeline entry), the client sees a checklist with progress, and
 * clients are reminded about missing required documents until they arrive (see sendDocumentReminders).
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { cases, documents, serviceTemplates, type User } from "../db/schema";
import { AppError } from "../errors";
import { OPEN_STATUSES, statusWhenRequestingFromClient } from "../domain";
import { isOutstanding, sameTitle } from "../checklist";
import { applyStatus, caseWithAccess, customerUserIdOf, portalCaseLink } from "./cases";
import { addEvent } from "./events";
import { notify } from "./notifications";
import { audit } from "./audit";
import { getSettings } from "./settings";

export type DocumentRequestItem = { title: string; note?: string | null; required?: boolean };

/** Most documents asked for in one go. */
export const MAX_ITEMS_PER_REQUEST = 30;

const listText = (titles: string[]) => titles.map((t) => `• ${t}`).join("\n");

/**
 * Requests several documents from the client at once. Titles already requested (and not yet approved) on this
 * case are skipped, so applying a checklist twice doesn't ask twice. Returns the documents created.
 */
export async function requestDocuments(db: Database, actor: User, caseId: string, items: DocumentRequestItem[], opts: { templateName?: string } = {}) {
  const clean = items.map((i) => ({ title: i.title.trim().slice(0, 200), note: i.note?.trim() || null, required: i.required ?? true })).filter((i) => i.title);
  if (clean.length === 0 || clean.length > MAX_ITEMS_PER_REQUEST) throw new AppError("validation");
  return db.transaction(async (tx) => {
    const { c, access, customerUserId } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit || !access.documents) throw new AppError("forbidden");
    const existing = await tx.select({ title: documents.title, status: documents.status }).from(documents).where(and(eq(documents.caseId, c.id), eq(documents.visibility, "client")));
    const open = existing.filter((x) => x.status !== "approved");
    const fresh: typeof clean = [];
    for (const i of clean) if (!open.some((x) => sameTitle(x.title, i.title)) && !fresh.some((x) => sameTitle(x.title, i.title))) fresh.push(i);
    if (fresh.length === 0) return [];

    const created = await tx
      .insert(documents)
      .values(fresh.map((i) => ({ caseId: c.id, title: i.title, status: "requested" as const, requestNote: i.note, required: i.required, requestedById: actor.id, createdById: actor.id })))
      .returning();
    await addEvent(tx, {
      caseId: c.id,
      type: "documents_requested",
      actor,
      visibility: "client",
      data: { count: created.length, titles: created.map((d) => d.title).join(", ").slice(0, 500), template: opts.templateName ?? null },
    });
    const to = statusWhenRequestingFromClient(c.status);
    if (to) await applyStatus(tx, c, to, actor, { notifyClient: false });
    await notify(tx, {
      userIds: [customerUserId],
      type: "documents_requested",
      caseId: c.id,
      vars: { number: c.number, count: created.length, list: listText(created.map((d) => d.title)) },
      link: `${portalCaseLink(c.id)}?tab=documents`,
    });
    await audit(tx, { actorId: actor.id, action: "documents.request", entityType: "case", entityId: c.id, details: { count: created.length, template: opts.templateName ?? null } });
    return created;
  });
}

/** Requests a service template's checklist (optionally only some of its items, by index). */
export async function requestTemplateDocuments(db: Database, actor: User, caseId: string, templateId: string, onlyIndexes?: number[]) {
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) throw new AppError("not_found");
  const [tpl] = await db.select().from(serviceTemplates).where(eq(serviceTemplates.id, templateId));
  if (!tpl || !tpl.active) throw new AppError("not_found");
  const items = tpl.documents.filter((_, i) => !onlyIndexes || onlyIndexes.includes(i));
  if (items.length === 0) throw new AppError("validation", "This template has no documents");
  return requestDocuments(db, actor, caseId, items, { templateName: tpl.name });
}

/** Templates that have a document checklist, the case's own service category first. */
export async function checklistTemplatesFor(db: DbOrTx, category: string) {
  const rows = await db.select().from(serviceTemplates).where(eq(serviceTemplates.active, true)).orderBy(asc(serviceTemplates.name));
  return rows
    .filter((t) => t.documents.length > 0)
    .sort((a, b) => Number(b.category === category) - Number(a.category === category))
    .map((t) => ({ id: t.id, name: t.name, category: t.category, documents: t.documents }));
}

/**
 * Reminds clients about required documents they still haven't provided: one notification per case, every
 * `document_reminder_days` days after the request (or the last reminder), at most `document_reminder_max`
 * times per document, and only while the case is open. Run by the scheduled jobs.
 */
export async function sendDocumentReminders(db: Database, now = new Date()): Promise<{ cases: number; documents: number }> {
  const s = await getSettings(db);
  const days = Number(s.document_reminder_days ?? 3);
  const max = Number(s.document_reminder_max ?? 3);
  if (!days || days <= 0) return { cases: 0, documents: 0 };
  const due = new Date(now.getTime() - days * 86400_000);

  const rows = await db
    .select({ d: documents, c: cases })
    .from(documents)
    .innerJoin(cases, eq(cases.id, documents.caseId))
    .where(
      and(
        inArray(documents.status, ["requested", "needs_new_version"]),
        eq(documents.visibility, "client"),
        eq(documents.required, true),
        isNotNull(documents.requestedById),
        inArray(cases.status, OPEN_STATUSES),
        sql`${documents.reminderCount} < ${max}`,
        sql`coalesce(${documents.lastRemindedAt}, ${documents.updatedAt}) <= ${due}`,
      ),
    );
  const byCase = new Map<string, { c: (typeof rows)[number]["c"]; docs: (typeof rows)[number]["d"][] }>();
  for (const r of rows) {
    if (!isOutstanding(r.d.status)) continue;
    const entry = byCase.get(r.c.id) ?? { c: r.c, docs: [] };
    entry.docs.push(r.d);
    byCase.set(r.c.id, entry);
  }
  let docCount = 0;
  for (const { c, docs } of byCase.values()) {
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ reminderCount: sql`${documents.reminderCount} + 1`, lastRemindedAt: now })
        .where(inArray(documents.id, docs.map((d) => d.id)));
      await notify(tx, {
        userIds: [await customerUserIdOf(tx, c.customerId)],
        type: "documents_reminder",
        caseId: c.id,
        vars: { number: c.number, count: docs.length, list: listText(docs.map((d) => d.title)) },
        link: `${portalCaseLink(c.id)}?tab=documents`,
      });
      await addEvent(tx, { caseId: c.id, type: "documents_reminder", actorKind: "system", visibility: "internal", data: { count: docs.length } });
    });
    docCount += docs.length;
  }
  return { cases: byCase.size, documents: docCount };
}
