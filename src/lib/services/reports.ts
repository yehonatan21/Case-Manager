/**
 * Manager reports for a period (days in Israel time, inclusive): revenue, the request → quote → payment funnel,
 * response and handling times, requests by service type and status, and each team member's workload.
 *
 * Who sees what: admins everything; finance the revenue; case managers the operational parts (no revenue).
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { caseEvents, caseFeedback, cases, customers, meetings, payments, quotes, tasks, users, type User } from "../db/schema";
import { AppError } from "../errors";
import { OPEN_STATUSES, STAFF_ROLES } from "../domain";
import { zonedDay, zonedToUtc, DEFAULT_TZ } from "../meetings";
import { getSettings } from "./settings";

export type ReportAccess = { revenue: boolean; operations: boolean };

export function reportAccess(role: User["role"]): ReportAccess | null {
  if (role === "admin") return { revenue: true, operations: true };
  if (role === "finance") return { revenue: true, operations: false };
  if (role === "case_manager") return { revenue: false, operations: true };
  return null;
}

export type Period = { from: string; to: string };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A period from presets ("30d", "month", "last_month", "year") or explicit days; defaults to the last 30 days. */
export function resolvePeriod(input: { preset?: string | null; from?: string | null; to?: string | null }, now = new Date()): Period & { preset: string } {
  const today = zonedDay(now).day;
  const shift = (day: string, days: number) => zonedDay(new Date(zonedToUtc(day, "12:00").getTime() + days * 86_400_000)).day;
  const [y, m] = today.split("-").map(Number) as [number, number];
  if (input.from && input.to && DAY_RE.test(input.from) && DAY_RE.test(input.to) && input.from <= input.to) {
    // At most two years, so a report stays quick.
    const from = input.from < shift(input.to, -731) ? shift(input.to, -731) : input.from;
    return { from, to: input.to, preset: "custom" };
  }
  switch (input.preset) {
    case "7d":
      return { from: shift(today, -6), to: today, preset: "7d" };
    case "90d":
      return { from: shift(today, -89), to: today, preset: "90d" };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today, preset: "month" };
    case "last_month": {
      const first = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
      return { from: first, to: shift(`${today.slice(0, 7)}-01`, -1), preset: "last_month" };
    }
    case "year":
      return { from: `${y}-01-01`, to: today, preset: "year" };
    default:
      return { from: shift(today, -29), to: today, preset: "30d" };
  }
}

export const bounds = (p: Period) => ({ start: zonedToUtc(p.from, "00:00"), end: zonedToUtc(zonedDay(new Date(zonedToUtc(p.to, "12:00").getTime() + 86_400_000)).day, "00:00") });

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

export type CaseRow = {
  id: string;
  number: string;
  title: string;
  client: string;
  serviceCategory: string;
  status: string;
  assignee: string | null;
  createdAt: Date;
  firstResponseHours: number | null;
  quoteSentAt: Date | null;
  quoteTotalCents: number | null;
  paidCents: number;
  completedAt: Date | null;
};

export type Report = Awaited<ReturnType<typeof buildReport>>;

export async function buildReport(db: DbOrTx, actor: User, period: Period) {
  const access = reportAccess(actor.role);
  if (!access) throw new AppError("forbidden");
  const { start, end } = bounds(period);
  const settings = await getSettings(db);
  const currency = settings.currency;

  // ---- Revenue (payments that succeeded in the period) ----
  let revenue: null | {
    currency: string;
    totalCents: number;
    count: number;
    averageCents: number | null;
    otherCurrencies: { currency: string; totalCents: number; count: number }[];
    byMonth: { month: string; totalCents: number; count: number }[];
    byService: { category: string; totalCents: number; count: number }[];
  } = null;
  if (access.revenue) {
    const paid = await db
      .select({ amount: payments.amountCents, currency: payments.currency, paidAt: payments.paidAt, category: cases.serviceCategory })
      .from(payments)
      .innerJoin(cases, eq(cases.id, payments.caseId))
      .where(and(eq(payments.status, "succeeded"), isNotNull(payments.paidAt), gte(payments.paidAt, start), lt(payments.paidAt, end)));
    const main = paid.filter((p) => p.currency === currency);
    const others = new Map<string, { totalCents: number; count: number }>();
    for (const p of paid.filter((x) => x.currency !== currency)) {
      const o = others.get(p.currency) ?? { totalCents: 0, count: 0 };
      others.set(p.currency, { totalCents: o.totalCents + p.amount, count: o.count + 1 });
    }
    // Every month of the period, also months without payments.
    const months: string[] = [];
    for (let m = period.from.slice(0, 7); m <= period.to.slice(0, 7); ) {
      months.push(m);
      const [yy, mm] = m.split("-").map(Number) as [number, number];
      m = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
    }
    const byMonth = months.map((month) => {
      const inMonth = main.filter((p) => zonedDay(p.paidAt!).day.startsWith(month));
      return { month, totalCents: inMonth.reduce((a, p) => a + p.amount, 0), count: inMonth.length };
    });
    const svc = new Map<string, { totalCents: number; count: number }>();
    for (const p of main) {
      const o = svc.get(p.category) ?? { totalCents: 0, count: 0 };
      svc.set(p.category, { totalCents: o.totalCents + p.amount, count: o.count + 1 });
    }
    const total = main.reduce((a, p) => a + p.amount, 0);
    revenue = {
      currency,
      totalCents: total,
      count: main.length,
      averageCents: main.length ? Math.round(total / main.length) : null,
      otherCurrencies: [...others].map(([c, v]) => ({ currency: c, ...v })),
      byMonth,
      byService: [...svc].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.totalCents - a.totalCents),
    };
  }

  // ---- Requests opened in the period: funnel, times, types, statuses ----
  const created = await db
    .select({ c: cases, client: users.name })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(gte(cases.createdAt, start), lt(cases.createdAt, end)));
  const ids = created.map((r) => r.c.id);
  const firstStaff = ids.length
    ? await db
        .select({ caseId: caseEvents.caseId, at: sql<Date>`min(${caseEvents.createdAt})`.mapWith((v) => new Date(v)) })
        .from(caseEvents)
        .where(and(inArray(caseEvents.caseId, ids), eq(caseEvents.actorKind, "staff"), eq(caseEvents.visibility, "client")))
        .groupBy(caseEvents.caseId)
    : [];
  const completedEv = ids.length
    ? await db
        .select({ caseId: caseEvents.caseId, at: sql<Date>`min(${caseEvents.createdAt})`.mapWith((v) => new Date(v)) })
        .from(caseEvents)
        .where(and(inArray(caseEvents.caseId, ids), eq(caseEvents.type, "case_completed")))
        .groupBy(caseEvents.caseId)
    : [];
  const quoteRows = ids.length
    ? await db.select({ caseId: quotes.caseId, sentAt: quotes.sentAt, approvedAt: quotes.approvedAt, total: quotes.totalCents, version: quotes.version }).from(quotes).where(inArray(quotes.caseId, ids))
    : [];
  const paidRows = ids.length
    ? await db.select({ caseId: payments.caseId, amount: payments.amountCents }).from(payments).where(and(inArray(payments.caseId, ids), eq(payments.status, "succeeded")))
    : [];
  const staffRows = await db.select({ id: users.id, name: users.name, role: users.role, status: users.status }).from(users).where(inArray(users.role, STAFF_ROLES));
  const staffName = new Map(staffRows.map((s) => [s.id, s.name]));

  const rows: CaseRow[] = created.map(({ c, client }) => {
    const first = firstStaff.find((f) => f.caseId === c.id)?.at ?? null;
    const sent = quoteRows.filter((q) => q.caseId === c.id && q.sentAt).sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime());
    const latest = [...quoteRows.filter((q) => q.caseId === c.id && q.sentAt)].sort((a, b) => b.version - a.version)[0];
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      client,
      serviceCategory: c.serviceCategory,
      status: c.status,
      assignee: c.assigneeId ? staffName.get(c.assigneeId) ?? null : null,
      createdAt: c.createdAt,
      firstResponseHours: first ? Math.max(0, hoursBetween(c.createdAt, first)) : null,
      quoteSentAt: sent[0]?.sentAt ?? null,
      quoteTotalCents: latest?.total ?? null,
      paidCents: paidRows.filter((p) => p.caseId === c.id).reduce((a, p) => a + p.amount, 0),
      completedAt: completedEv.find((e) => e.caseId === c.id)?.at ?? null,
    };
  });

  const funnel = {
    requests: rows.length,
    quoted: rows.filter((r) => r.quoteSentAt).length,
    approved: new Set(quoteRows.filter((q) => q.approvedAt).map((q) => q.caseId)).size,
    paid: rows.filter((r) => r.paidCents > 0).length,
  };
  const responses = rows.map((r) => r.firstResponseHours).filter((x): x is number => x !== null);
  const toQuote = rows.filter((r) => r.quoteSentAt).map((r) => hoursBetween(r.createdAt, r.quoteSentAt!));
  const toComplete = rows.filter((r) => r.completedAt).map((r) => hoursBetween(r.createdAt, r.completedAt!) / 24);
  const sla = settings.first_response_sla_hours;
  const times = {
    slaHours: sla,
    responded: responses.length,
    awaitingResponse: rows.length - responses.length,
    medianFirstResponseHours: median(responses),
    averageFirstResponseHours: avg(responses),
    withinSlaShare: responses.length ? responses.filter((h) => h <= sla).length / rows.length : null,
    medianHoursToQuote: median(toQuote),
    medianDaysToComplete: median(toComplete),
  };
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.serviceCategory, (byType.get(r.serviceCategory) ?? 0) + 1);
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  // ---- Client satisfaction (ratings given in the period) ----
  const ratings = await db
    .select({ rating: caseFeedback.rating, comment: caseFeedback.comment, createdAt: caseFeedback.createdAt, staffId: caseFeedback.staffId, caseNumber: cases.number, caseId: cases.id })
    .from(caseFeedback)
    .innerJoin(cases, eq(cases.id, caseFeedback.caseId))
    .where(and(gte(caseFeedback.createdAt, start), lt(caseFeedback.createdAt, end)));
  const [{ n: completedCount } = { n: 0 }] = await db
    .select({ n: sql<number>`count(distinct ${caseEvents.caseId})::int` })
    .from(caseEvents)
    .where(and(eq(caseEvents.type, "case_completed"), gte(caseEvents.createdAt, start), lt(caseEvents.createdAt, end)));
  const satisfaction = {
    count: ratings.length,
    average: avg(ratings.map((r) => r.rating)),
    distribution: [5, 4, 3, 2, 1].map((star) => ({ star, count: ratings.filter((r) => r.rating === star).length })),
    completed: completedCount,
    responseRate: completedCount ? Math.min(1, ratings.length / completedCount) : null,
    recent: access.operations
      ? ratings
          .filter((r) => r.comment)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 5)
          .map((r) => ({ rating: r.rating, comment: r.comment!, caseNumber: r.caseNumber, caseId: r.caseId, createdAt: r.createdAt }))
      : [],
  };

  // ---- Team workload (now, and during the period) ----
  let team: null | { id: string; name: string; role: string; openCases: number; newCases: number; completed: number; openTasks: number; overdueTasks: number; meetings: number; medianFirstResponseHours: number | null; averageRating: number | null; ratings: number }[] = null;
  if (access.operations) {
    const today = zonedDay(new Date(), DEFAULT_TZ).day;
    const open = await db.select({ assigneeId: cases.assigneeId, n: sql<number>`count(*)::int` }).from(cases).where(inArray(cases.status, OPEN_STATUSES)).groupBy(cases.assigneeId);
    const taskRows = await db.select({ assigneeId: tasks.assigneeId, dueDate: tasks.dueDate }).from(tasks).where(inArray(tasks.status, ["todo", "in_progress", "waiting"]));
    const meetingRows = await db
      .select({ staffId: meetings.staffId, n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.status, "scheduled"), gte(meetings.startAt, start), lt(meetings.startAt, end)))
      .groupBy(meetings.staffId);
    const completedInPeriod = await db
      .select({ assigneeId: cases.assigneeId, n: sql<number>`count(*)::int` })
      .from(caseEvents)
      .innerJoin(cases, eq(cases.id, caseEvents.caseId))
      .where(and(eq(caseEvents.type, "case_completed"), gte(caseEvents.createdAt, start), lt(caseEvents.createdAt, end)))
      .groupBy(cases.assigneeId);
    team = staffRows
      .filter((s) => s.status !== "disabled")
      .map((s) => {
        const mine = rows.filter((r) => created.find((x) => x.c.id === r.id)?.c.assigneeId === s.id);
        return {
          id: s.id,
          name: s.name,
          role: s.role,
          openCases: open.find((o) => o.assigneeId === s.id)?.n ?? 0,
          newCases: mine.length,
          completed: completedInPeriod.find((o) => o.assigneeId === s.id)?.n ?? 0,
          openTasks: taskRows.filter((t) => t.assigneeId === s.id).length,
          overdueTasks: taskRows.filter((t) => t.assigneeId === s.id && t.dueDate && t.dueDate < today).length,
          meetings: meetingRows.find((m) => m.staffId === s.id)?.n ?? 0,
          medianFirstResponseHours: median(mine.map((r) => r.firstResponseHours).filter((x): x is number => x !== null)),
          averageRating: avg(ratings.filter((x) => x.staffId === s.id).map((x) => x.rating)),
          ratings: ratings.filter((x) => x.staffId === s.id).length,
        };
      })
      .filter((s) => s.openCases + s.newCases + s.completed + s.openTasks + s.meetings > 0 || s.role !== "finance")
      .sort((a, b) => b.openCases - a.openCases || a.name.localeCompare(b.name));
  }

  return {
    period,
    access,
    currency,
    revenue,
    funnel,
    times,
    byType: [...byType].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byStatus: [...byStatus].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    unassigned: access.operations ? rows.filter((r) => !r.assignee && OPEN_STATUSES.includes(r.status as (typeof OPEN_STATUSES)[number])).length : null,
    team,
    satisfaction,
    // The list behind the numbers (for the export); amounts only for those who see revenue.
    cases: rows.map((r) => (access.revenue ? r : { ...r, quoteTotalCents: null, paidCents: 0 })),
  };
}
