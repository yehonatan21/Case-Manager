import { and, eq, gt, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { cases, customers, documents, quotes, tasks, users, type User } from "../db/schema";
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
  | "quote_declined";

export type AttentionItem = {
  key: string;
  caseId: string;
  number: string;
  title: string;
  customerName: string;
  urgency: string;
  reason: AttentionReason;
  vars: Record<string, string>;
  at: Date;
  score: number;
};

const URGENCY_WEIGHT: Record<string, number> = { low: 0, normal: 10, high: 25, urgent: 45 };

/** "Needs attention now", ranked by urgency, age and what's missing. */
export async function attentionItems(db: DbOrTx, actor: User, slaHours: number): Promise<AttentionItem[]> {
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
    })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId));

  const now = Date.now();
  const hours = (d: Date | null) => (d ? (now - d.getTime()) / 3600000 : 0);
  const items: AttentionItem[] = [];
  const push = (c: { id: string; number: string; title: string; urgency: string; customerName: string }, reason: AttentionReason, at: Date, extra = 0, vars: Record<string, string> = {}) =>
    items.push({
      key: `${c.id}:${reason}:${vars.title ?? ""}`,
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
    push(c, breach ? "sla_breach" : "new_request", c.createdAt, breach ? 40 : 20);
  }
  for (const c of await base.where(
    and(scope, inArray(cases.status, ["under_review", "active", "quote_preparation"]), sql`${cases.lastClientActivityAt} > coalesce(${cases.lastStaffActivityAt}, 'epoch'::timestamptz)`),
  )) {
    push(c, "client_responded", c.lastClient ?? c.updatedAt, 30);
  }
  for (const c of await base.where(and(scope, eq(cases.status, "declined"), gt(cases.updatedAt, new Date(now - 7 * 86400000))))) {
    push(c, "quote_declined", c.updatedAt, 5);
  }
  const clar = await db
    .selectDistinct({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: quotes.updatedAt })
    .from(quotes)
    .innerJoin(cases, eq(cases.id, quotes.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(quotes.status, "clarification_requested")));
  for (const c of clar) push(c, "quote_clarification", c.at, 30);
  for (const c of await base.where(and(scope, eq(cases.status, "awaiting_payment"), lt(cases.updatedAt, new Date(now - 2 * 86400000))))) {
    push(c, "quote_approved", c.updatedAt, 0);
  }
  const overdue = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, taskTitle: tasks.title, due: tasks.dueDate, taskAssignee: tasks.assigneeId })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, inArray(tasks.status, ["todo", "in_progress", "waiting"]), lt(tasks.dueDate, todayIso()), actor.role === "staff" ? or(eq(tasks.assigneeId, actor.id), isNull(tasks.assigneeId)) : undefined));
  for (const t of overdue) push(t, "overdue_task", new Date(t.due + "T00:00:00Z"), 15, { title: t.taskTitle });
  const docs = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, docTitle: documents.title, at: documents.updatedAt })
    .from(documents)
    .innerJoin(cases, eq(cases.id, documents.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(documents.status, "uploaded"), eq(documents.createdById, customers.userId)));
  const docsByCase = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (!docsByCase.has(d.id)) docsByCase.set(d.id, d);
  for (const d of docsByCase.values()) push(d, "document_uploaded", d.at, 10);

  // Also count client uploads into staff-requested slots.
  const reqUploads = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, urgency: cases.urgency, customerName: users.name, at: documents.updatedAt })
    .from(documents)
    .innerJoin(cases, eq(cases.id, documents.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(scope, eq(documents.status, "uploaded"), sql`${documents.requestedById} is not null`));
  for (const d of reqUploads) if (!docsByCase.has(d.id)) {
    docsByCase.set(d.id, { ...d, docTitle: "" });
    push(d, "document_uploaded", d.at, 10);
  }

  // One row per case+reason, highest score first.
  return items.sort((a, b) => b.score - a.score).slice(0, 15);
}
