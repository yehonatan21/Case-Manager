import { and, eq, gt, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { cases, customers, documents, invoices, meetings, payments, quotes, tasks, users, type User } from "../db/schema";
import { canOpenPage } from "../auth/permissions";
import { zonedDay, zonedToUtc } from "../meetings";
import { addDays } from "../calendar-view";
import { staffCaseScope } from "./cases";
import { todayIso } from "../utils";

export async function dashboardMetrics(db: DbOrTx, actor: User) {
  const scope = staffCaseScope(actor);
  const count = async (where: SQL | undefined) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cases).where(and(scope, where));
    return r?.n ?? 0;
  };
  const [qp] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quotes)
    .innerJoin(cases, eq(cases.id, quotes.caseId))
    .where(and(scope, inArray(quotes.status, ["sent", "clarification_requested"])));
  const [ot] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .where(and(scope, inArray(tasks.status, ["todo", "in_progress", "waiting"]), lt(tasks.dueDate, todayIso())));
  return {
    newRequests: await count(eq(cases.status, "submitted")),
    awaitingQuote: await count(inArray(cases.status, ["under_review", "quote_preparation"])),
    quotesPending: qp?.n ?? 0,
    activeCases: await count(eq(cases.status, "active")),
    awaitingClient: await count(inArray(cases.status, ["awaiting_client", "awaiting_information"])),
    overdueTasks: ot?.n ?? 0,
  };
}

export type AttentionReason =
  | "new_request"
  | "sla_breach"
  | "client_responded"
  | "quote_clarification"
  | "quote_approved"
  | "overdue_task"
  | "document_uploaded"
  | "quote_declined"
  | "meeting_today"
  | "payment_failed"
  | "invoice_failed";

export type AttentionItem = {
  key: string;
  /** Where the item is handled: the case (on the right tab), or the Payments page. */
  href: string;
  caseId: string;
  number: string;
  title: string;
  customerName: string;
  urgency: string;
  reason: AttentionReason;
  vars: Record<string, string>;
  at: Date;
  score: number;
  /** Whether it's the person's own: their case, their task, their meeting, or a kind of item only their role handles. */
  mine: boolean;
};

export type AttentionScope = "mine" | "all";

const URGENCY_WEIGHT: Record<string, number> = { low: 0, normal: 10, high: 25, urgent: 45 };

/**
 * The attention center: what needs doing now across cases, tasks, documents, quotes, meetings, payments and
 * invoices, ranked by urgency, age and what's at stake. "mine" (the default on the dashboard) keeps the person's own
 * items — their cases, their tasks, their meetings — plus what only their role handles (new requests for those who
 * take them; failed payments and invoices for admins and finance). "all" is everything they may see.
 */
export async function attentionItems(db: DbOrTx, actor: User, slaHours: number, opts: { scope?: AttentionScope } = {}): Promise<AttentionItem[]> {
  const onlyMine = opts.scope === "mine";
  const scope = staffCaseScope(actor);
  const base = db
    .select({
      id: cases.id,
      number: cases.number,
      title: cases.title,
      status: cases.status,
      urgency: cases.urgency,
      createdAt: cases.createdAt,
      updatedAt: cases.updatedAt,
      lastClient: cases.lastClientActivityAt,
      lastStaff: cases.lastStaffActivityAt,
      customerName: users.name,
      assigneeId: cases.assigneeId,
    })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId));

  const now = Date.now();
  const hours = (d: Date | null) => (d ? (now - d.getTime()) / 3600000 : 0);
  const items: AttentionItem[] = [];
  const push = (
    c: { id: string; number: string; title: string; urgency: string; customerName: string },
    reason: AttentionReason,
    at: Date,
    extra = 0,
    vars: Record<string, string> = {},
    o: { mine: boolean; href?: string },
  ) =>
    items.push({
      key: `${c.id}:${reason}:${vars.title ?? vars.time ?? ""}`,
      href: o.href ?? `/admin/cases/${c.id}`,
      mine: o.mine,
      caseId: c.id,
      number: c.number,
      title: c.title,
      customerName: c.customerName,
      urgency: c.urgency,
      reason,
      vars,
      at,
      score: (URGENCY_WEIGHT[c.urgency] ?? 10) + Math.min(hours(at), 240) / 4 + extra,
    });

  for (const c of await base.where(and(scope, eq(cases.status, "submitted")))) {
    const breach = hours(c.createdAt) > slaHours;
    push(c, breach ? "sla_breach" : "new_request", c.createdAt, breach ? 40 : 20, {}, { mine: c.assigneeId === actor.id || (!c.assigneeId && canOpenPage(actor.role, "inbox")) });
  }
  for (const c of await base.where(
    and(scope, inArray(cases.status, ["under_review", "active", "quote_preparation"]), sql`${cases.lastClientActivityAt} > coalesce(${cases.lastStaffActivityAt}, 'epoch'::timestamptz)`),
  )) {
    push(c, "client_responded", c.lastClient ?? c.updatedAt, 30, {}, { mine: c.assigneeId === actor.id, href: `/admin/cases/${c.id}?tab=messages` });
  }
  for (const c of await base.where(and(scope, eq(cases.status, "declined"), gt(cases.updatedAt, new Date(now - 7 * 86400000))))) {
    push(c, "quote_declined", c.updatedAt, 5, {}, { mine: c.assigneeId === actor.id, href: `/admin/cases/${c.id}?tab=quotes` });
  }
  const clar = await db
    .selectDistinct({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: quotes.updatedAt, assigneeId: cases.assigneeId })
    .from(quotes)
    .innerJoin(cases, eq(cases.id, quotes.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(quotes.status, "clarification_requested")));
  for (const c of clar) push(c, "quote_clarification", c.at, 30, {}, { mine: c.assigneeId === actor.id, href: `/admin/cases/${c.id}?tab=quotes` });
  for (const c of await base.where(and(scope, eq(cases.status, "awaiting_payment"), lt(cases.updatedAt, new Date(now - 2 * 86400000))))) {
    push(c, "quote_approved", c.updatedAt, 0, {}, { mine: c.assigneeId === actor.id, href: `/admin/cases/${c.id}?tab=quotes` });
  }
  const overdue = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, taskTitle: tasks.title, due: tasks.dueDate, taskAssignee: tasks.assigneeId, caseAssignee: cases.assigneeId })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, inArray(tasks.status, ["todo", "in_progress", "waiting"]), lt(tasks.dueDate, todayIso()), actor.role === "staff" ? or(eq(tasks.assigneeId, actor.id), isNull(tasks.assigneeId)) : undefined));
  for (const t of overdue) push(t, "overdue_task", new Date(t.due + "T00:00:00Z"), 15, { title: t.taskTitle }, { mine: t.taskAssignee === actor.id || (!t.taskAssignee && t.caseAssignee === actor.id), href: `/admin/cases/${t.id}?tab=tasks` });
  const docs = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, docTitle: documents.title, at: documents.updatedAt, assigneeId: cases.assigneeId })
    .from(documents)
    .innerJoin(cases, eq(cases.id, documents.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(documents.status, "uploaded"), eq(documents.createdById, customers.userId)));
  const docsByCase = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (!docsByCase.has(d.id)) docsByCase.set(d.id, d);
  for (const d of docsByCase.values()) push(d, "document_uploaded", d.at, 10, {}, { mine: d.assigneeId === actor.id, href: `/admin/cases/${d.id}?tab=documents` });

  // Also count client uploads into staff-requested slots.
  const reqUploads = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: documents.updatedAt, assigneeId: cases.assigneeId })
    .from(documents)
    .innerJoin(cases, eq(cases.id, documents.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(documents.status, "uploaded"), sql`${documents.requestedById} is not null`));
  for (const d of reqUploads) if (!docsByCase.has(d.id)) {
    docsByCase.set(d.id, { ...d, docTitle: "" });
    push(d, "document_uploaded", d.at, 10, {}, { mine: d.assigneeId === actor.id, href: `/admin/cases/${d.id}?tab=documents` });
  }

  // Today's meetings (the office's today): one's own, or everyone's in "all".
  const today = zonedDay(new Date()).day;
  const todays = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: meetings.startAt, staffId: meetings.staffId })
    .from(meetings)
    .innerJoin(cases, eq(cases.id, meetings.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(meetings.status, "scheduled"), gte(meetings.startAt, zonedToUtc(today, "00:00")), lt(meetings.startAt, zonedToUtc(addDays(today, 1), "00:00")), gt(meetings.endAt, new Date(now))));
  for (const m of todays) {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(m.at);
    // Sooner is higher; the score doesn't grow with age like the others.
    const soon = Math.max(0, 40 - (m.at.getTime() - now) / 3600000 * 5);
    items.push({ key: `${m.id}:meeting_today:${time}`, href: `/admin/cases/${m.id}?tab=meetings`, mine: m.staffId === actor.id, caseId: m.id, number: m.number, title: m.title, customerName: m.customerName, urgency: m.urgency, reason: "meeting_today", vars: { time }, at: m.at, score: (URGENCY_WEIGHT[m.urgency] ?? 10) + soon });
  }

  // Money that didn't come in, for those who handle payments.
  if (canOpenPage(actor.role, "payments")) {
    const week = new Date(now - 7 * 86400000);
    const failedPayments = await db
      .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: payments.updatedAt })
      .from(payments)
      .innerJoin(cases, eq(cases.id, payments.caseId))
      .innerJoin(customers, eq(customers.id, cases.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(and(scope, eq(payments.status, "failed"), gt(payments.updatedAt, week)));
    for (const p of failedPayments) push(p, "payment_failed", p.at, 25, {}, { mine: true, href: `/admin/cases/${p.id}?tab=quotes` });
    const failedInvoices = await db
      .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: invoices.createdAt })
      .from(invoices)
      .innerJoin(cases, eq(cases.id, invoices.caseId))
      .innerJoin(customers, eq(customers.id, cases.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(and(scope, eq(invoices.status, "failed")));
    for (const i of failedInvoices) push(i, "invoice_failed", i.at, 20, {}, { mine: true, href: "/admin/payments?status=succeeded" });
  }

  // One row per case+reason, highest score first.
  return items.filter((i) => !onlyMine || i.mine).sort((a, b) => b.score - a.score).slice(0, 15);
}
