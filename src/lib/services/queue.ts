import { and, asc, eq, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { cases, customers, savedViews, tasks, users, type CaseStatus, type Urgency, type User } from "../db/schema";
import { AppError, errorCodeOf } from "../errors";
import { OPEN_STATUSES, isActivationWithoutPayment } from "../domain";
import { zonedDay } from "../meetings";
import { assignCase, changeStatus, staffCaseScope, updateCaseFields } from "./cases";
import { likeTerm, phoneMatches } from "./customers";
import { notify } from "./notifications";

/** The Work queue's ready-made views. */
export const QUEUE_VIEWS = ["mine", "unassigned", "overdue", "due_soon", "waiting_client", "waiting_third_party", "stale", "all"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
/** Statuses where the next step is the client's (answer, upload, approve, pay). */
export const WAITING_CLIENT_STATUSES: CaseStatus[] = ["awaiting_information", "awaiting_client", "quote_sent", "awaiting_payment"];
export const STALE_DAYS = 7;
export const DUE_SOON_DAYS = 7;
export const QUEUE_PAGE_SIZE = 50;
const OPEN_TASK: ("todo" | "in_progress" | "waiting")[] = ["todo", "in_progress", "waiting"];

/** Today in the office's time zone (YYYY-MM-DD); a deadline "today" means the office's today. */
export const officeToday = (now = new Date()) => zonedDay(now).day;
const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The latest activity on a case by anyone, or when it was opened. */
const lastActivity = sql<Date>`coalesce(greatest(${cases.lastClientActivityAt}, ${cases.lastStaffActivityAt}), ${cases.createdAt})`;
const overdueTasks = (today: string) =>
  sql<number>`(select count(*)::int from ${tasks} where ${tasks.caseId} = ${cases.id} and ${tasks.status} in ('todo', 'in_progress', 'waiting') and ${tasks.dueDate} < ${today})`;
const nextTaskDue = sql<string | null>`(select min(${tasks.dueDate})::text from ${tasks} where ${tasks.caseId} = ${cases.id} and ${tasks.status} in ('todo', 'in_progress', 'waiting'))`;

function viewCondition(view: QueueView, actor: User, today: string): SQL | undefined {
  switch (view) {
    case "mine":
      return eq(cases.assigneeId, actor.id);
    case "unassigned":
      return isNull(cases.assigneeId);
    case "overdue":
      return or(lt(cases.dueDate, today), sql`${overdueTasks(today)} > 0`);
    case "due_soon":
      return and(gte(cases.dueDate, today), lte(cases.dueDate, plusDays(today, DUE_SOON_DAYS)));
    case "waiting_client":
      return inArray(cases.status, WAITING_CLIENT_STATUSES);
    case "waiting_third_party":
      return eq(cases.waitingOnThirdParty, true);
    case "stale":
      return sql`${lastActivity} < ${new Date(Date.now() - STALE_DAYS * 24 * 3600 * 1000).toISOString()}`;
    default:
      return undefined;
  }
}

export type QueueFilters = { view?: string; q?: string; category?: string; assignee?: string; urgency?: string; page?: number };

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** Open cases in a view of the Work queue, most pressing first: overdue, then urgency, then the nearest deadline. */
export async function listQueue(db: DbOrTx, actor: User, f: QueueFilters = {}) {
  const today = officeToday();
  const view: QueueView = (QUEUE_VIEWS as readonly string[]).includes(f.view ?? "") ? (f.view as QueueView) : "mine";
  const conds: (SQL | undefined)[] = [staffCaseScope(actor), inArray(cases.status, OPEN_STATUSES), viewCondition(view, actor, today)];
  if (f.q?.trim()) {
    const like = likeTerm(f.q);
    conds.push(or(ilike(cases.number, like), ilike(cases.title, like), ilike(cases.description, like), ilike(users.name, like), ilike(users.email, like), phoneMatches(users.phone, f.q)));
  }
  if (f.category) conds.push(eq(cases.serviceCategory, f.category));
  if (f.urgency && ["low", "normal", "high", "urgent"].includes(f.urgency)) conds.push(eq(cases.urgency, f.urgency as Urgency));
  if (f.assignee === "unassigned") conds.push(isNull(cases.assigneeId));
  else if (f.assignee && isUuid(f.assignee)) conds.push(eq(cases.assigneeId, f.assignee));
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const overdue = overdueTasks(today);
  // No deadline compares as NULL; coalesce so those count as "not late" (DESC would put NULLs first).
  const late = sql<boolean>`coalesce(${cases.dueDate} < ${today}, false) or ${overdue} > 0`;
  const rows = await db
    .select({
      id: cases.id,
      number: cases.number,
      title: cases.title,
      status: cases.status,
      urgency: cases.urgency,
      serviceCategory: cases.serviceCategory,
      assigneeId: cases.assigneeId,
      assigneeName: sql<string | null>`(select name from ${users} u2 where u2.id = ${cases.assigneeId})`,
      customerName: users.name,
      dueDate: cases.dueDate,
      waitingOnThirdParty: cases.waitingOnThirdParty,
      waitingNote: cases.waitingNote,
      overdueTasks: overdue,
      nextTaskDue,
      late,
      lastActivityAt: lastActivity,
      createdAt: cases.createdAt,
      updatedAt: cases.updatedAt,
    })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(...conds.filter(Boolean)))
    .orderBy(
      sql`${late} desc`,
      sql`case ${cases.urgency} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
      sql`${cases.dueDate} asc nulls last`,
      asc(lastActivity),
      asc(cases.id),
    )
    .limit(QUEUE_PAGE_SIZE + 1)
    .offset((page - 1) * QUEUE_PAGE_SIZE);
  return { view, page, today, rows: rows.slice(0, QUEUE_PAGE_SIZE), hasNext: rows.length > QUEUE_PAGE_SIZE };
}
export type QueueRow = Awaited<ReturnType<typeof listQueue>>["rows"][number];

/** How many open cases each view holds, for the tabs. */
export async function queueCounts(db: DbOrTx, actor: User): Promise<Record<QueueView, number>> {
  const today = officeToday();
  const f = (v: QueueView) => sql<number>`count(*) filter (where ${viewCondition(v, actor, today) ?? sql`true`})::int`;
  const [r] = await db
    .select({
      mine: f("mine"),
      unassigned: f("unassigned"),
      overdue: f("overdue"),
      due_soon: f("due_soon"),
      waiting_client: f("waiting_client"),
      waiting_third_party: f("waiting_third_party"),
      stale: f("stale"),
      all: sql<number>`count(*)::int`,
    })
    .from(cases)
    .where(and(staffCaseScope(actor), inArray(cases.status, OPEN_STATUSES)));
  return r as Record<QueueView, number>;
}

/** The menu's "My Work" counter: my open cases that are past their deadline or have overdue tasks. */
export async function myOverdueCaseCount(db: DbOrTx, actor: User): Promise<number> {
  const today = officeToday();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(staffCaseScope(actor), inArray(cases.status, OPEN_STATUSES), viewCondition("mine", actor, today), viewCondition("overdue", actor, today)));
  return r?.n ?? 0;
}

/** The menu's Tasks counter: my open tasks past their due day (the office's today), on cases I may see. */
export async function myOverdueTaskCount(db: DbOrTx, actor: User): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .where(and(staffCaseScope(actor), eq(tasks.assigneeId, actor.id), inArray(tasks.status, OPEN_TASK), lt(tasks.dueDate, officeToday())));
  return r?.n ?? 0;
}

/** Each team member's open work, for managers planning the day. */
export async function teamWorkload(db: DbOrTx, actor: User) {
  if (actor.role !== "admin" && actor.role !== "case_manager") throw new AppError("forbidden");
  const today = officeToday();
  const soon = plusDays(today, DUE_SOON_DAYS);
  const staff = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inArray(users.role, ["admin", "case_manager", "staff"]), ne(users.status, "disabled")))
    .orderBy(asc(users.name));
  const caseRows = await db
    .select({
      assigneeId: cases.assigneeId,
      open: sql<number>`count(*)::int`,
      urgent: sql<number>`count(*) filter (where ${cases.urgency} in ('urgent', 'high'))::int`,
      overdue: sql<number>`count(*) filter (where ${cases.dueDate} < ${today})::int`,
      dueSoon: sql<number>`count(*) filter (where ${cases.dueDate} >= ${today} and ${cases.dueDate} <= ${soon})::int`,
      waitingClient: sql<number>`count(*) filter (where ${inArray(cases.status, WAITING_CLIENT_STATUSES)})::int`,
    })
    .from(cases)
    .where(inArray(cases.status, OPEN_STATUSES))
    .groupBy(cases.assigneeId);
  const taskRows = await db
    .select({
      assigneeId: tasks.assigneeId,
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today})::int`,
    })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .where(and(inArray(tasks.status, OPEN_TASK), eq(tasks.requiresClientAction, false), inArray(cases.status, OPEN_STATUSES)))
    .groupBy(tasks.assigneeId);
  const byCase = new Map(caseRows.map((r) => [r.assigneeId, r]));
  const byTask = new Map(taskRows.map((r) => [r.assigneeId, r]));
  const zero = { open: 0, urgent: 0, overdue: 0, dueSoon: 0, waitingClient: 0 };
  const members = staff.map((s) => {
    const c = byCase.get(s.id) ?? zero;
    const t = byTask.get(s.id) ?? { open: 0, overdue: 0 };
    return { id: s.id, name: s.name, role: s.role, cases: { open: c.open, urgent: c.urgent, overdue: c.overdue, dueSoon: c.dueSoon, waitingClient: c.waitingClient }, tasks: { open: t.open, overdue: t.overdue } };
  });
  const un = byCase.get(null) ?? zero;
  return { members, unassigned: { open: un.open, urgent: un.urgent, overdue: un.overdue } };
}

export type BulkAction =
  | { type: "assign"; assigneeId: string | null }
  | { type: "urgency"; urgency: Urgency }
  | { type: "due_date"; dueDate: string | null }
  | { type: "status"; status: CaseStatus };

/**
 * Applies one change to many cases, each with the same checks as on its own page. Cases that can't take it
 * (no access, a status they can't move to, starting work before payment, which needs a reason) are listed.
 */
export async function bulkUpdateCases(db: Database, actor: User, ids: string[], action: BulkAction) {
  if (actor.role !== "admin" && actor.role !== "case_manager") throw new AppError("forbidden");
  const unique = [...new Set(ids)].filter(isUuid);
  if (unique.length === 0 || unique.length > 100) throw new AppError("validation");
  const numbers = new Map((await db.select({ id: cases.id, number: cases.number, status: cases.status }).from(cases).where(inArray(cases.id, unique))).map((r) => [r.id, r]));
  const done: string[] = [];
  const failed: { id: string; number: string; code: string }[] = [];
  for (const id of unique) {
    const row = numbers.get(id);
    if (!row) {
      failed.push({ id, number: "", code: "not_found" });
      continue;
    }
    try {
      if (action.type === "assign") await assignCase(db, actor, id, action.assigneeId);
      else if (action.type === "urgency") await updateCaseFields(db, actor, id, { urgency: action.urgency });
      else if (action.type === "due_date") await updateCaseFields(db, actor, id, { dueDate: action.dueDate });
      else {
        // Each one needs its own reason; that's done on the case page.
        if (isActivationWithoutPayment(row.status, action.status)) throw new AppError("activation_reason_required");
        if (row.status !== action.status) await changeStatus(db, actor, id, action.status);
      }
      done.push(id);
    } catch (e) {
      failed.push({ id, number: row.number, code: errorCodeOf(e) });
    }
  }
  return { done, failed };
}

// ---------------- Saved views ----------------

const VIEW_PARAMS = ["view", "q", "category", "assignee", "urgency"];
/** Keeps only the Work queue's own filters, so a saved view can't carry anything else. */
export function cleanViewQuery(query: string): string {
  const src = new URLSearchParams(query.replace(/^\?/, ""));
  const out = new URLSearchParams();
  for (const k of VIEW_PARAMS) {
    const v = src.get(k)?.trim();
    if (v) out.set(k, v.slice(0, 200));
  }
  return out.toString();
}

export async function listSavedViews(db: DbOrTx, user: Pick<User, "id">) {
  return db.select().from(savedViews).where(eq(savedViews.userId, user.id)).orderBy(asc(savedViews.name));
}

export async function saveView(db: DbOrTx, user: User, input: { name: string; query: string }) {
  const name = input.name.trim().slice(0, 60);
  const query = cleanViewQuery(input.query);
  if (!name) throw new AppError("validation");
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(savedViews).where(eq(savedViews.userId, user.id));
  const [existing] = await db.select({ id: savedViews.id }).from(savedViews).where(and(eq(savedViews.userId, user.id), eq(savedViews.name, name)));
  if (!existing && n >= 20) throw new AppError("validation", "too many saved views");
  const [row] = await db
    .insert(savedViews)
    .values({ userId: user.id, name, query })
    .onConflictDoUpdate({ target: [savedViews.userId, savedViews.name], set: { query } })
    .returning();
  return row!;
}

export async function deleteSavedView(db: DbOrTx, user: Pick<User, "id">, id: string) {
  if (!isUuid(id)) throw new AppError("not_found");
  const rows = await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, user.id))).returning({ id: savedViews.id });
  if (rows.length === 0) throw new AppError("not_found");
}

// ---------------- Deadline reminders ----------------

/**
 * Reminds whoever handles a case the day before its deadline and on the day itself (once a day each),
 * and the admins when an unassigned case reaches its deadline. Run by the scheduled jobs.
 */
export async function sendDeadlineReminders(db: DbOrTx): Promise<number> {
  const today = officeToday();
  const tomorrow = plusDays(today, 1);
  const due = await db
    .select({ id: cases.id, number: cases.number, title: cases.title, dueDate: cases.dueDate, assigneeId: cases.assigneeId })
    .from(cases)
    .where(and(inArray(cases.status, OPEN_STATUSES), inArray(cases.dueDate, [today, tomorrow]), or(isNull(cases.dueRemindedOn), lt(cases.dueRemindedOn, today))));
  if (due.length === 0) return 0;
  const admins = (await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.id);
  for (const c of due) {
    const to = c.assigneeId ? [c.assigneeId] : admins;
    await notify(db, { userIds: to, type: c.dueDate === today ? "case_due_today" : "case_due_tomorrow", caseId: c.id, vars: { number: c.number, title: c.title }, link: `/admin/cases/${c.id}` });
    await db.update(cases).set({ dueRemindedOn: today }).where(eq(cases.id, c.id));
  }
  return due.length;
}
