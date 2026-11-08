import { and, asc, desc, eq, gte, inArray, isNull, lt, max, or } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { aiRuns, cases, customers, quoteItems, quotes, users, type Case, type Quote, type QuoteItem, type User } from "../db/schema";
import { AppError } from "../errors";
import { sha256 } from "../crypto";
import { addDaysIso, todayIso } from "../utils";
import { applyStatus, adminCaseLink, caseWithAccess, isQuoteExpired, portalCaseLink, staffCaseScope } from "./cases";
import { addEvent } from "./events";
import { audit } from "./audit";
import { notify, staffRecipients } from "./notifications";
import { getSettings } from "./settings";
import { postMessage } from "./messages";

export type QuoteItemInput = { description: string; quantity: number; unitPriceCents: number; priceListItemId?: string | null };

/** Money is integer cents. Line totals round half away from zero; VAT is computed on the subtotal. */
export function computeTotals(items: Pick<QuoteItemInput, "quantity" | "unitPriceCents">[], taxRatePercent: number, pricesIncludeTax: boolean) {
  const lineTotals = items.map((i) => Math.round(Number(i.quantity) * i.unitPriceCents));
  const sum = lineTotals.reduce((a, b) => a + b, 0);
  const rate = taxRatePercent / 100;
  if (pricesIncludeTax) {
    const subtotal = Math.round(sum / (1 + rate));
    return { lineTotals, subtotalCents: subtotal, taxCents: sum - subtotal, totalCents: sum };
  }
  const tax = Math.round(sum * rate);
  return { lineTotals, subtotalCents: sum, taxCents: tax, totalCents: sum + tax };
}

async function quoteWithCase(db: DbOrTx, actor: User, quoteId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(quoteId)) throw new AppError("not_found");
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) throw new AppError("not_found");
  const ctx = await caseWithAccess(db, actor, q.caseId);
  if (!ctx.access.viewQuotes) throw new AppError("not_found");
  if (ctx.access.isClient && q.status === "draft") throw new AppError("not_found");
  return { q, ...ctx };
}

export async function getQuoteForEditor(db: DbOrTx, actor: User, quoteId: string) {
  const { q, c, access } = await quoteWithCase(db, actor, quoteId);
  const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, q.id)).orderBy(asc(quoteItems.sortOrder));
  const [cust] = await db
    .select({ name: users.name, email: users.email })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, c.customerId));
  return { quote: q, items, case: c, access, customer: cust ?? null, expired: isQuoteExpired(q) };
}

const PRE_QUOTE: Case["status"][] = ["submitted", "under_review", "awaiting_information"];

/** Returns the case's existing draft, or creates a new versioned draft with default terms. */
export async function createDraftQuote(db: Database, actor: User, caseId: string): Promise<Quote> {
  return db.transaction(async (tx) => {
    const { c, access } = await caseWithAccess(tx, actor, caseId);
    if (!access.manageQuotes) throw new AppError("forbidden");
    const [existing] = await tx.select().from(quotes).where(and(eq(quotes.caseId, c.id), eq(quotes.status, "draft")));
    if (existing) return existing;
    const settings = await getSettings(tx);
    const [{ v } = { v: 0 }] = await tx.select({ v: max(quotes.version) }).from(quotes).where(eq(quotes.caseId, c.id));
    const [q] = await tx
      .insert(quotes)
      .values({
        caseId: c.id,
        version: (v ?? 0) + 1,
        status: "draft",
        serviceName: c.title,
        currency: settings.currency,
        taxRate: String(settings.vat_rate),
        validUntil: addDaysIso(settings.quote_validity_days),
        createdById: actor.id,
      })
      .returning();
    if (PRE_QUOTE.includes(c.status)) await applyStatus(tx, c, "quote_preparation", actor);
    return q!;
  });
}

export type QuoteDraftInput = {
  serviceName: string;
  scope: string;
  included: string;
  excluded: string;
  currency: string;
  taxRate: number;
  pricesIncludeTax: boolean;
  paymentTerms: string;
  timeline: string;
  terms: string;
  validUntil: string | null;
  items: QuoteItemInput[];
  aiRunId?: string | null;
};

export async function updateDraftQuote(db: Database, actor: User, quoteId: string, input: QuoteDraftInput) {
  return db.transaction(async (tx) => {
    const { q, access } = await quoteWithCase(tx, actor, quoteId);
    if (!access.manageQuotes) throw new AppError("forbidden");
    if (q.status !== "draft") throw new AppError("quote_not_editable");
    const totals = computeTotals(input.items, input.taxRate, input.pricesIncludeTax);
    const [updated] = await tx
      .update(quotes)
      .set({
        serviceName: input.serviceName.trim(),
        scope: input.scope,
        included: input.included,
        excluded: input.excluded,
        currency: input.currency.toUpperCase(),
        taxRate: String(input.taxRate),
        pricesIncludeTax: input.pricesIncludeTax,
        paymentTerms: input.paymentTerms,
        timeline: input.timeline,
        terms: input.terms,
        validUntil: input.validUntil || null,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        ...(input.aiRunId ? { aiRunId: input.aiRunId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, q.id))
      .returning();
    await tx.delete(quoteItems).where(eq(quoteItems.quoteId, q.id));
    if (input.items.length) {
      await tx.insert(quoteItems).values(
        input.items.map((i, idx) => ({
          quoteId: q.id,
          description: i.description.trim(),
          quantity: String(i.quantity),
          unitPriceCents: Math.round(i.unitPriceCents),
          priceListItemId: i.priceListItemId ?? null,
          sortOrder: idx,
        })),
      );
    }
    return updated!;
  });
}

function snapshot(q: Quote, items: QuoteItem[]) {
  return {
    id: q.id,
    version: q.version,
    serviceName: q.serviceName,
    scope: q.scope,
    included: q.included,
    excluded: q.excluded,
    currency: q.currency,
    taxRate: q.taxRate,
    pricesIncludeTax: q.pricesIncludeTax,
    subtotalCents: q.subtotalCents,
    taxCents: q.taxCents,
    totalCents: q.totalCents,
    paymentTerms: q.paymentTerms,
    timeline: q.timeline,
    terms: q.terms,
    validUntil: q.validUntil,
    items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
  };
}

/** Human approval gate: only an authorized staff member can send a quote to the customer. */
export async function sendQuote(db: Database, actor: User, quoteId: string) {
  return db.transaction(async (tx) => {
    const { q, c, access, customerUserId } = await quoteWithCase(tx, actor, quoteId);
    if (!access.manageQuotes) throw new AppError("forbidden");
    if (q.status !== "draft") throw new AppError("quote_not_editable");
    const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, q.id)).orderBy(asc(quoteItems.sortOrder));
    if (q.totalCents <= 0 || items.length === 0 || !q.serviceName.trim()) throw new AppError("quote_not_sendable");
    if (q.validUntil && q.validUntil < todayIso()) throw new AppError("quote_not_sendable");
    if (["active", "awaiting_client", "completed", "closed", "cancelled"].includes(c.status)) throw new AppError("invalid_transition");

    await tx
      .update(quotes)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(quotes.caseId, c.id), inArray(quotes.status, ["sent", "clarification_requested", "approved", "expired"])));
    const [sent] = await tx
      .update(quotes)
      .set({ status: "sent", sentAt: new Date(), sentById: actor.id, sentSnapshot: snapshot(q, items), updatedAt: new Date() })
      .where(eq(quotes.id, q.id))
      .returning();
    if (q.aiRunId) await tx.update(aiRuns).set({ approvedById: actor.id, approvedAt: new Date() }).where(eq(aiRuns.id, q.aiRunId));
    await applyStatus(tx, c, "quote_sent", actor, { notifyClient: false });
    await addEvent(tx, { caseId: c.id, type: "quote_sent", actor, visibility: "client", data: { version: q.version } });
    await notify(tx, { userIds: [customerUserId], type: "quote_ready", caseId: c.id, vars: { number: c.number }, link: `${portalCaseLink(c.id)}?tab=quote` });
    await audit(tx, { actorId: actor.id, action: "quote.send", entityType: "quote", entityId: q.id, details: { totalCents: q.totalCents, version: q.version } });
    return sent!;
  });
}

/** Customer approval — recorded with quote version, approver identity, time, IP and a hash of the approved content. */
export async function approveQuote(db: Database, actor: User, quoteId: string, ip: string | null) {
  return db.transaction(async (tx) => {
    const { q, c, access } = await quoteWithCase(tx, actor, quoteId);
    if (!access.isClient || !access.pay) throw new AppError("forbidden");
    if (q.status !== "sent" && q.status !== "clarification_requested") throw new AppError("quote_not_approvable");
    if (isQuoteExpired(q)) throw new AppError("quote_expired");
    const hash = sha256(JSON.stringify(q.sentSnapshot ?? {}));
    const [approved] = await tx
      .update(quotes)
      .set({ status: "approved", approvedAt: new Date(), approvedById: actor.id, approvalIp: ip, approvalSnapshotHash: hash, updatedAt: new Date() })
      .where(and(eq(quotes.id, q.id), inArray(quotes.status, ["sent", "clarification_requested"])))
      .returning();
    if (!approved) throw new AppError("conflict");
    await addEvent(tx, { caseId: c.id, type: "quote_approved", actor, visibility: "client", data: { version: q.version } });
    await applyStatus(tx, c, "awaiting_payment", actor, { notifyClient: false });
    await notify(tx, { userIds: await staffRecipients(tx, c), type: "quote_approved", caseId: c.id, vars: { number: c.number, version: q.version }, link: adminCaseLink(c.id) });
    await audit(tx, { actorId: actor.id, action: "quote.approve", entityType: "quote", entityId: q.id, ip, details: { version: q.version, hash } });
    return approved;
  });
}

export async function declineQuote(db: Database, actor: User, quoteId: string, reason: string | null) {
  return db.transaction(async (tx) => {
    const { q, c, access } = await quoteWithCase(tx, actor, quoteId);
    if (!access.isClient || !access.pay) throw new AppError("forbidden");
    if (q.status !== "sent" && q.status !== "clarification_requested") throw new AppError("quote_not_approvable");
    await tx.update(quotes).set({ status: "declined", declinedAt: new Date(), declineReason: reason?.trim() || null, updatedAt: new Date() }).where(eq(quotes.id, q.id));
    await addEvent(tx, { caseId: c.id, type: "quote_declined", actor, visibility: "client", data: { version: q.version } });
    await applyStatus(tx, c, "declined", actor, { notifyClient: false });
    await notify(tx, { userIds: await staffRecipients(tx, c), type: "quote_declined", caseId: c.id, vars: { number: c.number, reason: reason?.trim() || "—" }, link: adminCaseLink(c.id) });
    await audit(tx, { actorId: actor.id, action: "quote.decline", entityType: "quote", entityId: q.id });
  });
}

export async function requestQuoteClarification(db: Database, actor: User, quoteId: string, text: string) {
  const { q, c, access } = await quoteWithCase(db, actor, quoteId);
  if (!access.isClient) throw new AppError("forbidden");
  if (!["sent", "clarification_requested", "expired"].includes(q.status) && !isQuoteExpired(q)) throw new AppError("quote_not_approvable");
  await db.transaction(async (tx) => {
    if (q.status === "sent") await tx.update(quotes).set({ status: "clarification_requested", updatedAt: new Date() }).where(eq(quotes.id, q.id));
    await addEvent(tx, { caseId: c.id, type: "quote_clarification", actor, visibility: "client", data: { version: q.version } });
    await notify(tx, { userIds: await staffRecipients(tx, c), type: "quote_clarification", caseId: c.id, vars: { number: c.number, text: text.slice(0, 200) }, link: adminCaseLink(c.id) });
  });
  await postMessage(db, actor, c.id, { body: text, kind: "thread" });
}

/** Creates a new draft version from an existing quote (sent quotes are immutable). */
export async function reviseQuote(db: Database, actor: User, quoteId: string) {
  return db.transaction(async (tx) => {
    const { q, c, access } = await quoteWithCase(tx, actor, quoteId);
    if (!access.manageQuotes) throw new AppError("forbidden");
    const [draft] = await tx.select().from(quotes).where(and(eq(quotes.caseId, c.id), eq(quotes.status, "draft")));
    if (draft) return draft;
    const settings = await getSettings(tx);
    const [{ v } = { v: 0 }] = await tx.select({ v: max(quotes.version) }).from(quotes).where(eq(quotes.caseId, c.id));
    const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, q.id)).orderBy(asc(quoteItems.sortOrder));
    const [n] = await tx
      .insert(quotes)
      .values({
        caseId: c.id,
        version: (v ?? 0) + 1,
        status: "draft",
        serviceName: q.serviceName,
        scope: q.scope,
        included: q.included,
        excluded: q.excluded,
        currency: q.currency,
        taxRate: q.taxRate,
        pricesIncludeTax: q.pricesIncludeTax,
        subtotalCents: q.subtotalCents,
        taxCents: q.taxCents,
        totalCents: q.totalCents,
        paymentTerms: q.paymentTerms,
        timeline: q.timeline,
        terms: q.terms,
        validUntil: addDaysIso(settings.quote_validity_days),
        createdById: actor.id,
      })
      .returning();
    if (items.length) {
      await tx.insert(quoteItems).values(items.map((i) => ({ quoteId: n!.id, description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, priceListItemId: i.priceListItemId, sortOrder: i.sortOrder })));
    }
    if (c.status === "declined" || c.status === "quote_sent" || PRE_QUOTE.includes(c.status)) {
      await applyStatus(tx, c, "quote_preparation", actor, { notifyClient: false });
    }
    return n!;
  });
}

export async function deleteDraftQuote(db: Database, actor: User, quoteId: string) {
  const { q, access } = await quoteWithCase(db, actor, quoteId);
  if (!access.manageQuotes) throw new AppError("forbidden");
  if (q.status !== "draft") throw new AppError("quote_not_editable");
  await db.delete(quotes).where(eq(quotes.id, q.id));
}

export async function listQuotesForStaff(db: DbOrTx, actor: User) {
  const scope = staffCaseScope(actor);
  return db
    .select({ quote: quotes, caseNumber: cases.number, caseTitle: cases.title, caseId: cases.id, customerName: users.name })
    .from(quotes)
    .innerJoin(cases, eq(cases.id, quotes.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(scope)
    .orderBy(desc(quotes.updatedAt))
    .limit(300);
}

/** Job: mark quotes past their validity date as expired. */
export async function expireQuotes(db: DbOrTx) {
  const rows = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(inArray(quotes.status, ["sent", "clarification_requested"]), lt(quotes.validUntil, todayIso())))
    .returning({ id: quotes.id });
  return rows.length;
}

/**
 * Follow-ups for sent quotes with no answer: one reminder to the client after N days, and one note to the
 * handler (or the admins) after M days. Settings → General; 0 turns either off. Run by the scheduled jobs.
 */
export async function sendQuoteFollowups(db: DbOrTx): Promise<{ client: number; staff: number }> {
  const s = await getSettings(db);
  const day = 24 * 3600 * 1000;
  let client = 0;
  let staff = 0;
  const open = and(eq(quotes.status, "sent"), or(isNull(quotes.validUntil), gte(quotes.validUntil, todayIso())));
  if (s.quote_followup_client_days > 0) {
    const due = await db
      .select({ q: quotes, number: cases.number, customerId: cases.customerId, caseId: cases.id })
      .from(quotes)
      .innerJoin(cases, eq(cases.id, quotes.caseId))
      .where(and(open, isNull(quotes.clientFollowupAt), lt(quotes.sentAt, new Date(Date.now() - s.quote_followup_client_days * day))));
    for (const r of due) {
      const [cu] = await db.select({ id: customers.userId }).from(customers).where(eq(customers.id, r.customerId));
      if (cu) await notify(db, { userIds: [cu.id], type: "quote_followup_client", caseId: r.caseId, vars: { number: r.number }, link: `/portal/cases/${r.caseId}?tab=quote` });
      await db.update(quotes).set({ clientFollowupAt: new Date() }).where(eq(quotes.id, r.q.id));
      client++;
    }
  }
  if (s.quote_followup_staff_days > 0) {
    const due = await db
      .select({ q: quotes, number: cases.number, assigneeId: cases.assigneeId, caseId: cases.id })
      .from(quotes)
      .innerJoin(cases, eq(cases.id, quotes.caseId))
      .where(and(open, isNull(quotes.staffFollowupAt), lt(quotes.sentAt, new Date(Date.now() - s.quote_followup_staff_days * day))));
    const admins = due.some((r) => !r.assigneeId) ? (await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.id) : [];
    for (const r of due) {
      const days = Math.floor((Date.now() - new Date(r.q.sentAt!).getTime()) / day);
      await notify(db, { userIds: r.assigneeId ? [r.assigneeId] : admins, type: "quote_followup_staff", caseId: r.caseId, vars: { number: r.number, days }, link: `/admin/cases/${r.caseId}?tab=quotes` });
      await db.update(quotes).set({ staffFollowupAt: new Date() }).where(eq(quotes.id, r.q.id));
      staff++;
    }
  }
  return { client, staff };
}
