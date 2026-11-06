import { and, asc, desc, eq, exists, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database, DbOrTx, Tx } from "../db";
import {
  caseCounters,
  caseEvents,
  caseReads,
  cases,
  customers,
  documentFiles,
  signatures,
  caseFeedback,
  documents,
  intakeSessions,
  messages,
  organizations,
  payments,
  quoteItems,
  quotes,
  tasks,
  users,
  type Case,
  type CustomerType,
  type CaseStatus,
  type IntakeSession,
  type IntakeSummary,
  type Urgency,
  type User,
} from "../db/schema";
import { AppError } from "../errors";
import { canCreateCasesForClients, caseAccess, type CaseAccess } from "../auth/permissions";
import { CLIENT_STATUS, OPEN_STATUSES, canTransition, isActivationWithoutPayment, isStaffRole, type ActivationReason } from "../domain";
import { addEvent } from "./events";
import { resolveCategory } from "./categories";
import { audit } from "./audit";
import { notify, staffRecipients, markCaseNotificationsRead } from "./notifications";
import { dictionaries } from "../i18n/dictionaries";
import type { Locale } from "../i18n/config";
import { todayIso } from "../utils";
import { likeTerm, phoneMatches } from "./customers";

export const portalCaseLink = (id: string) => `/portal/cases/${id}`;
export const adminCaseLink = (id: string) => `/admin/cases/${id}`;

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function getCaseRow(db: DbOrTx, caseId: string): Promise<Case> {
  if (!isUuid(caseId)) throw new AppError("not_found");
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) throw new AppError("not_found");
  return c;
}

export async function customerUserIdOf(db: DbOrTx, customerId: string): Promise<string> {
  const [row] = await db.select({ userId: customers.userId }).from(customers).where(eq(customers.id, customerId));
  return row!.userId;
}

/** Loads a case and the caller's permissions on it. Unauthorized access looks like "not found". */
export async function caseWithAccess(db: DbOrTx, user: User, caseId: string): Promise<{ c: Case; access: CaseAccess; customerUserId: string }> {
  const c = await getCaseRow(db, caseId);
  const customerUserId = await customerUserIdOf(db, c.customerId);
  let isTaskAssignee = false;
  if (user.role === "staff" || user.role === "case_manager") {
    const [t] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.caseId, c.id), eq(tasks.assigneeId, user.id)))
      .limit(1);
    isTaskAssignee = !!t;
  }
  const access = caseAccess({ user, caseAssigneeId: c.assigneeId, caseCustomerUserId: customerUserId, isTaskAssignee });
  if (!access.view) throw new AppError("not_found");
  return { c, access, customerUserId };
}

async function nextCaseNumber(tx: DbOrTx): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await tx
    .insert(caseCounters)
    .values({ year, value: 1 })
    .onConflictDoUpdate({ target: caseCounters.year, set: { value: sql`${caseCounters.value} + 1` } })
    .returning({ value: caseCounters.value });
  return `CASE-${year}-${String(row!.value).padStart(4, "0")}`;
}

export type SubmitEdits = {
  request_title: string;
  request_description: string;
  customer_goal: string;
  service_category: string;
  urgency: Urgency;
  known_facts: { label: string; value: string }[];
  constraints: string[];
  missing_information: string[];
  additional_notes?: string;
};

/** Turns a reviewed intake into a case: number, initial event, staff notification. */
export async function submitIntakeAsCase(db: Database, opts: { user: User; session: IntakeSession; edits: SubmitEdits }): Promise<Case> {
  const { user, session, edits } = opts;
  if (session.status !== "active") throw new AppError("conflict", "Already submitted");
  if (isStaffRole(user.role)) throw new AppError("forbidden", "Staff accounts cannot submit customer requests");
  const [cust] = await db.select().from(customers).where(eq(customers.userId, user.id));
  if (!cust) throw new AppError("forbidden");

  const summary: IntakeSummary = {
    ...(session.summary ?? ({} as IntakeSummary)),
    request_title: edits.request_title.trim(),
    request_description: edits.request_description.trim(),
    customer_goal: edits.customer_goal.trim(),
    service_category: await resolveCategory(db, edits.service_category),
    urgency: edits.urgency,
    known_facts: edits.known_facts.filter((f) => f.label.trim() || f.value.trim()),
    constraints: edits.constraints.filter((x) => x.trim()),
    missing_information: edits.missing_information.filter((x) => x.trim()),
    suggested_next_questions: session.summary?.suggested_next_questions ?? [],
    needs_human_review: true,
    assumptions: session.summary?.assumptions ?? [],
    additional_notes: edits.additional_notes?.trim() || undefined,
  };

  const created = await db.transaction(async (tx) => {
    const number = await nextCaseNumber(tx);
    const description = summary.additional_notes ? `${summary.request_description}\n\n${summary.additional_notes}` : summary.request_description;
    const [c] = await tx
      .insert(cases)
      .values({
        number,
        customerId: cust.id,
        title: summary.request_title,
        description,
        goal: summary.customer_goal,
        serviceCategory: summary.service_category,
        urgency: summary.urgency,
        status: "submitted",
        intakeSessionId: session.id,
        intakeSummary: summary,
        locale: session.locale,
        lastClientActivityAt: new Date(),
      })
      .returning();
    await tx.update(documents).set({ caseId: c!.id }).where(eq(documents.intakeSessionId, session.id));
    await tx
      .update(intakeSessions)
      .set({ status: "submitted", caseId: c!.id, userId: user.id, summary, updatedAt: new Date() })
      .where(eq(intakeSessions.id, session.id));
    await addEvent(tx, { caseId: c!.id, type: "case_submitted", actor: user, visibility: "client" });
    await audit(tx, { actorId: user.id, action: "case.submit", entityType: "case", entityId: c!.id });
    await notify(tx, {
      userIds: await staffRecipients(tx, { assigneeId: null }),
      type: "new_request",
      caseId: c!.id,
      vars: { number, title: c!.title },
      link: adminCaseLink(c!.id),
    });
    return c!;
  });
  return created;
}

/**
 * Applies a status change with its side effects. No permission check — callers enforce it.
 * The customer sees an event only when the customer-facing label actually changes.
 */
export async function applyStatus(
  tx: DbOrTx,
  c: Case,
  to: CaseStatus,
  actor: Pick<User, "id" | "role"> | null,
  opts: { notifyClient?: boolean } = {},
): Promise<Case> {
  if (c.status === to) return c;
  const nowTs = new Date();
  const patch: Partial<Case> = { status: to, updatedAt: nowTs };
  if (to === "completed") patch.completedAt = nowTs;
  if (to === "closed") patch.closedAt = nowTs;
  if (c.status === "submitted" && !c.reviewedAt) patch.reviewedAt = nowTs;
  const [updated] = await tx.update(cases).set(patch).where(eq(cases.id, c.id)).returning();
  const clientVisible = CLIENT_STATUS[c.status] !== CLIENT_STATUS[to];
  await addEvent(tx, {
    caseId: c.id,
    type: to === "completed" ? "case_completed" : to === "closed" ? "case_closed" : "status_changed",
    actor,
    actorKind: actor ? undefined : "system",
    visibility: clientVisible ? "client" : "internal",
    data: { from: c.status, to },
  });
  if (clientVisible && opts.notifyClient !== false) {
    const customerUserId = await customerUserIdOf(tx, c.customerId);
    const [cu] = await tx.select({ locale: users.locale }).from(users).where(eq(users.id, customerUserId));
    const loc = (cu?.locale as Locale) ?? "he";
    await notify(tx, {
      userIds: [customerUserId],
      type: to === "completed" ? "case_completed" : "status_changed",
      caseId: c.id,
      vars: { number: c.number, status: dictionaries[loc].status.client[CLIENT_STATUS[to]] },
      link: portalCaseLink(c.id),
    });
  }
  // A completed case: ask the client for a short rating (once; reopening and completing again doesn't ask twice).
  if (to === "completed") {
    const [done] = await tx.select({ id: caseFeedback.id }).from(caseFeedback).where(eq(caseFeedback.caseId, c.id));
    if (!done) {
      await notify(tx, { userIds: [await customerUserIdOf(tx, c.customerId)], type: "feedback_requested", caseId: c.id, vars: { number: c.number }, link: `${portalCaseLink(c.id)}#feedback` });
    }
  }
  return updated!;
}

export type ActivationInput = { reason: ActivationReason; note?: string };

/**
 * A manual status change. Starting work before the quote-and-payment flow (paid by bank transfer, free of
 * charge...) is allowed only to admins and case managers, with a reason that is kept in the case history.
 */
export async function changeStatus(db: Database, actor: User, caseId: string, to: CaseStatus, opts: { activation?: ActivationInput } = {}) {
  return db.transaction(async (tx) => {
    const { c, access } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit) throw new AppError("forbidden");
    if (!canTransition(c.status, to)) throw new AppError("invalid_transition");
    if (to === "active" && c.status === "awaiting_payment") throw new AppError("invalid_transition");
    const withoutPayment = isActivationWithoutPayment(c.status, to);
    let activation: ActivationInput | null = null;
    if (withoutPayment) {
      if (actor.role !== "admin" && actor.role !== "case_manager") throw new AppError("forbidden");
      const note = opts.activation?.note?.trim() ?? "";
      if (!opts.activation?.reason || (opts.activation.reason === "other" && !note)) throw new AppError("activation_reason_required");
      activation = { reason: opts.activation.reason, note: note.slice(0, 500) };
    }
    const updated = await applyStatus(tx, c, to, actor);
    if (activation) {
      // Kept apart from the status event, which the client may see: the reason is for the team only.
      await addEvent(tx, { caseId: c.id, type: "activated_without_payment", actor, visibility: "internal", data: { reason: activation.reason, note: activation.note || null } });
    }
    await audit(tx, { actorId: actor.id, action: "case.status", entityType: "case", entityId: c.id, details: { from: c.status, to, ...(activation ? { activation } : {}) } });
    return updated;
  });
}

export async function assignCase(db: Database, actor: User, caseId: string, assigneeId: string | null) {
  return db.transaction(async (tx) => {
    const { c, access } = await caseWithAccess(tx, actor, caseId);
    if (!access.assign) throw new AppError("forbidden");
    let assigneeName: string | null = null;
    if (assigneeId) {
      const [a] = await tx.select().from(users).where(eq(users.id, assigneeId));
      if (!a || !["admin", "case_manager", "staff"].includes(a.role) || a.status === "disabled") throw new AppError("validation");
      assigneeName = a.name;
    }
    await tx.update(cases).set({ assigneeId, updatedAt: new Date() }).where(eq(cases.id, c.id));
    await addEvent(tx, {
      caseId: c.id,
      type: assigneeId ? "assigned" : "unassigned",
      actor,
      visibility: "internal",
      data: { assignee: assigneeName },
    });
    if (assigneeId && assigneeId !== actor.id) {
      await notify(tx, { userIds: [assigneeId], type: "case_assigned", caseId: c.id, vars: { number: c.number, title: c.title }, link: adminCaseLink(c.id) });
    }
    if (c.status === "submitted") await applyStatus(tx, c, "under_review", actor);
    await audit(tx, { actorId: actor.id, action: "case.assign", entityType: "case", entityId: c.id, details: { assigneeId } });
  });
}

export type CaseFieldsPatch = {
  urgency?: Urgency;
  serviceCategory?: string;
  title?: string;
  /** YYYY-MM-DD, or null to clear. */
  dueDate?: string | null;
  /** Waiting on someone outside the office (an authority, a court), with who. */
  waiting?: { thirdParty: boolean; note?: string | null };
};

export async function updateCaseFields(db: DbOrTx, actor: User, caseId: string, patch: CaseFieldsPatch) {
  return inTx(db, async (tx) => {
    const { c, access } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit) throw new AppError("forbidden");
    const set: Partial<Case> = { updatedAt: new Date() };
    if (patch.urgency && patch.urgency !== c.urgency) {
      set.urgency = patch.urgency;
      await addEvent(tx, { caseId: c.id, type: "urgency_changed", actor, visibility: "internal", data: { urgency: patch.urgency } });
    }
    if (patch.dueDate !== undefined) {
      if (patch.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)) throw new AppError("validation");
      if (patch.dueDate !== c.dueDate) {
        set.dueDate = patch.dueDate;
        set.dueRemindedOn = null;
        await addEvent(tx, { caseId: c.id, type: patch.dueDate ? "due_date_set" : "due_date_cleared", actor, visibility: "internal", data: { dueDate: patch.dueDate } });
      }
    }
    if (patch.waiting) {
      const note = patch.waiting.thirdParty ? (patch.waiting.note ?? "").trim().slice(0, 200) || null : null;
      if (patch.waiting.thirdParty !== c.waitingOnThirdParty || note !== c.waitingNote) {
        set.waitingOnThirdParty = patch.waiting.thirdParty;
        set.waitingNote = note;
        await addEvent(tx, { caseId: c.id, type: patch.waiting.thirdParty ? "waiting_third_party" : "waiting_third_party_done", actor, visibility: "internal", data: { note } });
      }
    }
    if (patch.serviceCategory) set.serviceCategory = await resolveCategory(tx, patch.serviceCategory);
    if (patch.title?.trim()) set.title = patch.title.trim();
    await tx.update(cases).set(set).where(eq(cases.id, c.id));
    await audit(tx, { actorId: actor.id, action: "case.update", entityType: "case", entityId: c.id, details: patch as Record<string, unknown> });
  });
}

/** Runs `fn` in a transaction; inside a caller's transaction it becomes a savepoint. */
function inTx<T>(db: DbOrTx, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return (db as Database).transaction(fn as never) as Promise<T>;
}

/** A staff-authored update shown on the customer's timeline. */
export async function publishClientUpdate(db: Database, actor: User, caseId: string, text: string) {
  return db.transaction(async (tx) => {
    const { c, access, customerUserId } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit) throw new AppError("forbidden");
    await addEvent(tx, { caseId: c.id, type: "client_update", actor, visibility: "client", data: { text: text.trim().slice(0, 2000) } });
    await notify(tx, { userIds: [customerUserId], type: "client_update", caseId: c.id, vars: { number: c.number, text: text.trim().slice(0, 200) }, link: portalCaseLink(c.id) });
  });
}

export async function markCaseRead(db: DbOrTx, user: User, caseId: string) {
  await db
    .insert(caseReads)
    .values({ userId: user.id, caseId, lastReadAt: new Date() })
    .onConflictDoUpdate({ target: [caseReads.userId, caseReads.caseId], set: { lastReadAt: new Date() } });
  await markCaseNotificationsRead(db, user.id, caseId);
}

// ---------------- Read models ----------------

export type ClientAction =
  | { type: "approve_quote"; quoteId: string; service: string }
  | { type: "quote_expired"; quoteId: string }
  | { type: "pay"; quoteId: string }
  | { type: "upload"; documentId: string; title: string; note: string | null }
  | { type: "upload_many"; count: number; titles: string[] }
  | { type: "sign"; count: number; documentId: string; title: string }
  | { type: "reply" }
  | { type: "task"; title: string };

export function isQuoteExpired(q: { status: string; validUntil: string | null }) {
  return (q.status === "sent" || q.status === "clarification_requested") && !!q.validUntil && q.validUntil < todayIso();
}

export function computeClientActions(input: {
  status: CaseStatus;
  openQuote: { id: string; status: string; serviceName: string; validUntil: string | null } | null;
  requestedDocs: { id: string; title: string; requestNote: string | null; required?: boolean }[];
  clientTasks: { title: string }[];
  /** Documents waiting for the client's signature. */
  pendingSignatures?: { documentId: string; title: string }[];
}): ClientAction[] {
  const actions: ClientAction[] = [];
  const q = input.openQuote;
  if (q && (q.status === "sent" || q.status === "clarification_requested")) {
    actions.push(isQuoteExpired(q) ? { type: "quote_expired", quoteId: q.id } : { type: "approve_quote", quoteId: q.id, service: q.serviceName });
  }
  if (q && q.status === "expired" && input.status === "quote_sent") actions.push({ type: "quote_expired", quoteId: q.id });
  if (q && q.status === "approved" && input.status === "awaiting_payment") actions.push({ type: "pay", quoteId: q.id });
  // Required documents only (optional ones are listed in the documents tab); several become one action.
  const required = input.requestedDocs.filter((d) => d.required !== false);
  if (required.length === 1) actions.push({ type: "upload", documentId: required[0]!.id, title: required[0]!.title, note: required[0]!.requestNote });
  else if (required.length > 1) actions.push({ type: "upload_many", count: required.length, titles: required.map((d) => d.title) });
  const sign = input.pendingSignatures ?? [];
  if (sign.length) actions.push({ type: "sign", count: sign.length, documentId: sign[0]!.documentId, title: sign[0]!.title });
  if ((input.status === "awaiting_information" || input.status === "awaiting_client") && input.requestedDocs.length === 0 && sign.length === 0) actions.push({ type: "reply" });
  for (const t of input.clientTasks) actions.push({ type: "task", title: t.title });
  return actions;
}

async function clientActionsForCases(db: DbOrTx, rows: Pick<Case, "id" | "status">[]) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map<string, ClientAction[]>();
  const qs = await db
    .select({ id: quotes.id, caseId: quotes.caseId, status: quotes.status, serviceName: quotes.serviceName, validUntil: quotes.validUntil, version: quotes.version })
    .from(quotes)
    .where(and(inArray(quotes.caseId, ids), inArray(quotes.status, ["sent", "clarification_requested", "approved", "expired"])))
    .orderBy(desc(quotes.version));
  const docs = await db
    .select({ id: documents.id, caseId: documents.caseId, title: documents.title, requestNote: documents.requestNote, required: documents.required })
    .from(documents)
    .where(and(inArray(documents.caseId, ids), inArray(documents.status, ["requested", "needs_new_version"]), eq(documents.visibility, "client")));
  const ts = await db
    .select({ caseId: tasks.caseId, title: tasks.title })
    .from(tasks)
    .where(and(inArray(tasks.caseId, ids), eq(tasks.requiresClientAction, true), inArray(tasks.status, ["todo", "in_progress", "waiting"]), isNull(tasks.relatedDocumentId)));
  const sigs = await db
    .select({ caseId: signatures.caseId, documentId: documents.id, title: documents.title })
    .from(signatures)
    .innerJoin(documents, eq(documents.id, signatures.documentId))
    .where(and(inArray(signatures.caseId, ids), eq(signatures.status, "requested"), eq(documents.visibility, "client")));
  const map = new Map<string, ClientAction[]>();
  for (const r of rows) {
    map.set(
      r.id,
      computeClientActions({
        status: r.status,
        openQuote: qs.find((q) => q.caseId === r.id) ?? null,
        requestedDocs: docs.filter((d) => d.caseId === r.id),
        clientTasks: ts.filter((t) => t.caseId === r.id),
        pendingSignatures: sigs.filter((x) => x.caseId === r.id),
      }),
    );
  }
  return map;
}

export async function listCustomerCases(db: DbOrTx, user: User) {
  const rows = await db
    .select({ c: cases })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .where(eq(customers.userId, user.id))
    .orderBy(desc(cases.updatedAt));
  const list = rows.map((r) => r.c);
  const actions = await clientActionsForCases(db, list);
  const unread = await db
    .select({ caseId: messages.caseId, n: sql<number>`count(*)::int` })
    .from(messages)
    .leftJoin(caseReads, and(eq(caseReads.caseId, messages.caseId), eq(caseReads.userId, user.id)))
    .where(
      and(
        inArray(messages.caseId, list.length ? list.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"]),
        eq(messages.kind, "thread"),
        ne(messages.senderId, user.id),
        or(isNull(caseReads.lastReadAt), sql`${messages.createdAt} > ${caseReads.lastReadAt}`),
      ),
    )
    .groupBy(messages.caseId);
  return list.map((c) => ({ ...c, actions: actions.get(c.id) ?? [], unread: unread.find((u) => u.caseId === c.id)?.n ?? 0 }));
}

/** Everything a case page needs, filtered by what the viewer may see. */
export async function getCaseBundle(db: DbOrTx, user: User, caseId: string) {
  const { c, access, customerUserId } = await caseWithAccess(db, user, caseId);
  const client = access.isClient;

  const [customerRow] = await db
    .select({ user: users, customer: customers, organization: organizations })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(organizations, eq(organizations.id, customers.organizationId))
    .where(eq(customers.id, c.customerId));

  const [assignee] = c.assigneeId
    ? await db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role }).from(users).where(eq(users.id, c.assigneeId))
    : [null];

  const eventRows = await db
    .select({ e: caseEvents, actorName: users.name, actorRole: users.role })
    .from(caseEvents)
    .leftJoin(users, eq(users.id, caseEvents.actorId))
    .where(client ? and(eq(caseEvents.caseId, c.id), eq(caseEvents.visibility, "client")) : eq(caseEvents.caseId, c.id))
    .orderBy(desc(caseEvents.createdAt));

  const msgRows = access.messages
    ? await db
        .select({ m: messages, senderName: users.name, senderRole: users.role })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.senderId))
        .where(access.internal ? eq(messages.caseId, c.id) : and(eq(messages.caseId, c.id), eq(messages.kind, "thread")))
        .orderBy(asc(messages.createdAt))
    : [];

  const docRows = access.documents
    ? await db
        .select()
        .from(documents)
        .where(client ? and(eq(documents.caseId, c.id), eq(documents.visibility, "client")) : eq(documents.caseId, c.id))
        .orderBy(desc(documents.updatedAt))
    : [];
  const fileRows = docRows.length
    ? await db
        .select({ f: documentFiles, uploaderName: users.name })
        .from(documentFiles)
        .leftJoin(users, eq(users.id, documentFiles.uploadedById))
        .where(inArray(documentFiles.documentId, docRows.map((d) => d.id)))
        .orderBy(desc(documentFiles.version))
    : [];
  const docs = docRows.map((d) => ({ ...d, files: fileRows.filter((f) => f.f.documentId === d.id).map((f) => ({ ...f.f, uploaderName: f.uploaderName })) }));

  const taskRows = client
    ? await db.select().from(tasks).where(and(eq(tasks.caseId, c.id), eq(tasks.requiresClientAction, true))).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    : access.edit
      ? await db.select().from(tasks).where(eq(tasks.caseId, c.id)).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
      : [];

  const quoteRows = access.viewQuotes
    ? await db
        .select()
        .from(quotes)
        .where(client ? and(eq(quotes.caseId, c.id), ne(quotes.status, "draft")) : eq(quotes.caseId, c.id))
        .orderBy(desc(quotes.version))
    : [];
  const itemRows = quoteRows.length
    ? await db.select().from(quoteItems).where(inArray(quoteItems.quoteId, quoteRows.map((q) => q.id))).orderBy(asc(quoteItems.sortOrder))
    : [];
  const quoteList = quoteRows.map((q) => ({ ...q, items: itemRows.filter((i) => i.quoteId === q.id), expired: isQuoteExpired(q) }));
  const paymentRows = access.viewQuotes ? await db.select().from(payments).where(eq(payments.caseId, c.id)).orderBy(desc(payments.createdAt)) : [];

  const sigRows = access.documents
    ? await db
        .select()
        .from(signatures)
        .where(eq(signatures.caseId, c.id))
        .orderBy(desc(signatures.requestedAt))
    : [];
  const visibleDocIds = new Set(docs.map((d) => d.id));
  const signatureList = sigRows
    .filter((x) => !x.documentId || visibleDocIds.has(x.documentId))
    .filter((x) => !client || x.status !== "cancelled")
    .map((x) => ({
      id: x.id,
      documentId: x.documentId,
      quoteId: x.quoteId,
      status: x.status,
      note: x.note,
      requestedAt: x.requestedAt,
      fileVersion: x.fileVersion,
      signerName: x.signerName,
      signedAt: x.signedAt,
      method: x.method,
      originalSha256: x.originalSha256,
      signedSha256: x.signedSha256,
      // Evidence details are for staff.
      ip: client ? null : x.ip,
      userAgent: client ? null : x.userAgent,
    }));

  const openQuote = quoteList.find((q) => ["sent", "clarification_requested", "approved", "expired"].includes(q.status)) ?? null;
  const actions = computeClientActions({
    status: c.status,
    openQuote,
    requestedDocs: docs.filter((d) => (d.status === "requested" || d.status === "needs_new_version") && d.visibility === "client"),
    clientTasks: taskRows.filter((t) => t.requiresClientAction && !t.relatedDocumentId && ["todo", "in_progress", "waiting"].includes(t.status)),
    pendingSignatures: signatureList
      .filter((x) => x.status === "requested" && x.documentId)
      .map((x) => ({ documentId: x.documentId!, title: docs.find((d) => d.id === x.documentId)?.title ?? "" })),
  });

  return {
    case: client ? { ...c, aiSummary: null } : c,
    access,
    customerUserId,
    customer: customerRow ? { id: customerRow.customer.id, type: customerRow.customer.type, user: customerRow.user, organization: customerRow.organization } : null,
    assignee,
    events: eventRows.map((r) => ({ ...r.e, actorName: r.actorName, actorRole: r.actorRole })),
    messages: msgRows.map((r) => ({ ...r.m, senderName: r.senderName, senderRole: r.senderRole })),
    documents: docs,
    tasks: taskRows,
    quotes: quoteList,
    payments: paymentRows,
    signatures: signatureList,
    actions,
  };
}

export type CaseBundle = Awaited<ReturnType<typeof getCaseBundle>>;

/** SQL scope of cases a staff member may see in lists. */
export function staffCaseScope(actor: User): SQL | undefined {
  if (actor.role === "admin" || actor.role === "finance") return undefined;
  const taskOwner = exists(
    sql`(select 1 from ${tasks} where ${tasks.caseId} = ${cases.id} and ${tasks.assigneeId} = ${actor.id})`,
  );
  if (actor.role === "case_manager") return or(eq(cases.assigneeId, actor.id), isNull(cases.assigneeId), taskOwner);
  return or(eq(cases.assigneeId, actor.id), taskOwner);
}

export async function listStaffCases(
  db: DbOrTx,
  actor: User,
  filters: { status?: string; assignee?: string; q?: string; customerId?: string; limit?: number; offset?: number } = {},
) {
  const conds: (SQL | undefined)[] = [staffCaseScope(actor)];
  if (filters.status === "open") conds.push(inArray(cases.status, OPEN_STATUSES));
  else if (filters.status && filters.status !== "all") conds.push(eq(cases.status, filters.status as CaseStatus));
  if (filters.assignee === "me") conds.push(eq(cases.assigneeId, actor.id));
  else if (filters.assignee === "unassigned") conds.push(isNull(cases.assigneeId));
  else if (filters.assignee && isUuid(filters.assignee)) conds.push(eq(cases.assigneeId, filters.assignee));
  if (filters.customerId) conds.push(eq(cases.customerId, filters.customerId));
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const like = likeTerm(q);
    conds.push(
      or(
        ilike(cases.number, like),
        ilike(cases.title, like),
        ilike(cases.description, like),
        ilike(users.name, like),
        ilike(users.email, like),
        ilike(users.phone, like),
        phoneMatches(users.phone, q),
      ),
    );
  }
  const assignee = sql<string | null>`(select name from ${users} u2 where u2.id = ${cases.assigneeId})`;
  return db
    .select({
      id: cases.id,
      number: cases.number,
      title: cases.title,
      status: cases.status,
      urgency: cases.urgency,
      serviceCategory: cases.serviceCategory,
      createdAt: cases.createdAt,
      updatedAt: cases.updatedAt,
      assigneeId: cases.assigneeId,
      assigneeName: assignee,
      customerName: users.name,
      customerEmail: users.email,
      intakeSummary: cases.intakeSummary,
      aiSummary: cases.aiSummary,
      lastClientActivityAt: cases.lastClientActivityAt,
      lastStaffActivityAt: cases.lastStaffActivityAt,
    })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(...conds.filter(Boolean)))
    .orderBy(desc(cases.updatedAt), desc(cases.id))
    .limit(filters.limit ?? 200)
    .offset(filters.offset ?? 0);
}

export async function caseActivityStamp(db: DbOrTx, caseIds: string[], includeInternal: boolean): Promise<string> {
  if (caseIds.length === 0) return "0";
  const [e] = await db
    .select({ t: sql<string>`coalesce(max(${caseEvents.createdAt})::text, '0')` })
    .from(caseEvents)
    .where(includeInternal ? inArray(caseEvents.caseId, caseIds) : and(inArray(caseEvents.caseId, caseIds), eq(caseEvents.visibility, "client")));
  const [m] = await db
    .select({ t: sql<string>`coalesce(max(${messages.createdAt})::text, '0')`, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(includeInternal ? inArray(messages.caseId, caseIds) : and(inArray(messages.caseId, caseIds), eq(messages.kind, "thread")));
  const [d] = await db
    .select({ t: sql<string>`coalesce(max(${documents.updatedAt})::text, '0')` })
    .from(documents)
    .where(inArray(documents.caseId, caseIds));
  const [c] = await db
    .select({ t: sql<string>`coalesce(max(${cases.updatedAt})::text, '0')` })
    .from(cases)
    .where(inArray(cases.id, caseIds));
  return [e?.t, m?.t, m?.n, d?.t, c?.t].join("|");
}

export type { Tx };

export type StaffCaseInput = {
  customer: { id: string } | { email: string; name: string; phone?: string | null; customerType: CustomerType; organizationName?: string | null; locale: Locale };
  title: string;
  description: string;
  goal?: string;
  serviceCategory: string;
  urgency: Urgency;
  /** Assign the new case to the person creating it (default). Otherwise it goes to the inbox. */
  assignToMe?: boolean;
};

/**
 * Opens a case on behalf of a client (e.g. after a phone call), for an existing customer or a new one.
 * Admins and case managers only. A new client gets an account they can sign in to with their email;
 * they have not accepted the terms or AI processing, so AI tools stay off for them until they do.
 */
export async function createCaseForCustomer(db: Database, actor: User, input: StaffCaseInput): Promise<{ case: Case; customerCreated: boolean }> {
  if (!canCreateCasesForClients(actor.role)) throw new AppError("forbidden");
  const assignToMe = input.assignToMe ?? true;

  return db.transaction(async (tx) => {
    let customerId: string;
    let customerUser: User;
    let customerCreated = false;
    if ("id" in input.customer) {
      if (!isUuid(input.customer.id)) throw new AppError("not_found");
      const [row] = await tx.select({ c: customers, u: users }).from(customers).innerJoin(users, eq(users.id, customers.userId)).where(eq(customers.id, input.customer.id));
      if (!row) throw new AppError("not_found");
      if (row.u.status === "disabled") throw new AppError("account_disabled");
      customerId = row.c.id;
      customerUser = row.u;
    } else {
      const email = input.customer.email.trim().toLowerCase();
      const [existing] = await tx.select().from(users).where(eq(users.email, email));
      if (existing) {
        // Same email typed again: reuse the client's account rather than failing.
        if (existing.role !== "customer") throw new AppError("staff_email");
        if (existing.status === "disabled") throw new AppError("account_disabled");
        const [c] = await tx.select().from(customers).where(eq(customers.userId, existing.id));
        if (!c) throw new AppError("conflict");
        customerId = c.id;
        customerUser = existing;
      } else {
        const [u] = await tx
          .insert(users)
          .values({ email, name: input.customer.name.trim(), phone: input.customer.phone?.trim() || null, role: "customer", status: "active", locale: input.customer.locale })
          .returning();
        let organizationId: string | null = null;
        if (input.customer.customerType !== "private" && input.customer.organizationName?.trim()) {
          const [org] = await tx.insert(organizations).values({ name: input.customer.organizationName.trim() }).returning();
          organizationId = org!.id;
        }
        const [c] = await tx.insert(customers).values({ userId: u!.id, type: input.customer.customerType, organizationId }).returning();
        await audit(tx, { actorId: actor.id, action: "customer.create", entityType: "user", entityId: u!.id });
        customerId = c!.id;
        customerUser = u!;
        customerCreated = true;
      }
    }

    const number = await nextCaseNumber(tx);
    const [c] = await tx
      .insert(cases)
      .values({
        number,
        customerId,
        title: input.title.trim(),
        description: input.description.trim(),
        goal: input.goal?.trim() ?? "",
        serviceCategory: await resolveCategory(tx, input.serviceCategory),
        urgency: input.urgency,
        // Assigned straight away means the manager is already handling it, as after a normal assignment.
        status: assignToMe ? "under_review" : "submitted",
        assigneeId: assignToMe ? actor.id : null,
        reviewedAt: assignToMe ? new Date() : null,
        locale: customerUser.locale as Locale,
        lastStaffActivityAt: new Date(),
      })
      .returning();
    await addEvent(tx, { caseId: c!.id, type: "case_opened_by_staff", actor, visibility: "client" });
    if (assignToMe) await addEvent(tx, { caseId: c!.id, type: "assigned", actor, visibility: "internal", data: { assignee: actor.name } });
    await audit(tx, { actorId: actor.id, action: "case.create_for_customer", entityType: "case", entityId: c!.id });
    await notify(tx, { userIds: [customerUser.id], type: "case_opened_for_you", caseId: c!.id, vars: { number, title: c!.title }, link: portalCaseLink(c!.id) });
    if (!assignToMe) {
      await notify(tx, { userIds: await staffRecipients(tx, { assigneeId: null }), type: "new_request", caseId: c!.id, vars: { number, title: c!.title }, link: adminCaseLink(c!.id), excludeUserId: actor.id });
    }
    return { case: c!, customerCreated };
  });
}
