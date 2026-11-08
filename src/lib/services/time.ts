import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { caseExpenses, cases, payments, quotes, timeEntries, users, type User } from "../db/schema";
import { AppError } from "../errors";
import { zonedDay } from "../meetings";
import { caseWithAccess } from "./cases";
import { audit } from "./audit";
import { bounds } from "./reports";

const today = () => zonedDay(new Date()).day;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Admins and case managers correct anyone's time on a case; others only their own. */
const managesTime = (u: User) => u.role === "admin" || u.role === "case_manager";
/** Who sees money (revenue, cost rates, profit). */
export const seesProfit = (u: Pick<User, "role">) => u.role === "admin" || u.role === "finance";

async function editableCase(db: DbOrTx, actor: User, caseId: string) {
  const { c, access } = await caseWithAccess(db, actor, caseId);
  if (!access.edit) throw new AppError("forbidden");
  return c;
}

/** Minutes between a timer's start and now (at least 1). */
const elapsed = (startedAt: Date, now = new Date()) => Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / 60000));

/** Starts a timer on a case. A timer already running elsewhere for this user stops first (one at a time). */
export async function startTimer(db: Database, actor: User, caseId: string) {
  const c = await editableCase(db, actor, caseId);
  return db.transaction(async (tx) => {
    const running = await tx.select().from(timeEntries).where(and(eq(timeEntries.userId, actor.id), isNotNull(timeEntries.startedAt)));
    for (const r of running) {
      if (r.caseId === c.id) return r;
      await tx.update(timeEntries).set({ minutes: elapsed(r.startedAt!), startedAt: null }).where(eq(timeEntries.id, r.id));
    }
    const [e] = await tx.insert(timeEntries).values({ caseId: c.id, userId: actor.id, date: today(), startedAt: new Date() }).returning();
    return e!;
  });
}

/** Stops this user's running timer on a case and records the minutes. */
export async function stopTimer(db: Database, actor: User, caseId: string, note?: string) {
  const [r] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, actor.id), eq(timeEntries.caseId, caseId), isNotNull(timeEntries.startedAt)));
  if (!r) throw new AppError("not_found");
  const [e] = await db
    .update(timeEntries)
    .set({ minutes: elapsed(r.startedAt!), startedAt: null, ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}) })
    .where(eq(timeEntries.id, r.id))
    .returning();
  return e!;
}

export type TimeInput = { minutes: number; date: string; note?: string; billable?: boolean };

function cleanTime(input: TimeInput) {
  const minutes = Math.round(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60 || !DAY_RE.test(input.date)) throw new AppError("validation");
  return { minutes, date: input.date, note: (input.note ?? "").trim().slice(0, 500), billable: input.billable ?? true };
}

export async function addTime(db: Database, actor: User, caseId: string, input: TimeInput) {
  const c = await editableCase(db, actor, caseId);
  const [e] = await db.insert(timeEntries).values({ caseId: c.id, userId: actor.id, ...cleanTime(input) }).returning();
  return e!;
}

async function ownEntry(db: DbOrTx, actor: User, id: string) {
  const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
  if (!e) throw new AppError("not_found");
  await editableCase(db, actor, e.caseId);
  if (e.userId !== actor.id && !managesTime(actor)) throw new AppError("forbidden");
  return e;
}

export async function updateTime(db: Database, actor: User, id: string, input: TimeInput) {
  const e = await ownEntry(db, actor, id);
  const [u] = await db.update(timeEntries).set({ ...cleanTime(input), startedAt: null }).where(eq(timeEntries.id, e.id)).returning();
  return u!;
}

export async function deleteTime(db: Database, actor: User, id: string) {
  const e = await ownEntry(db, actor, id);
  await db.delete(timeEntries).where(eq(timeEntries.id, e.id));
}

// ---------------- Expenses ----------------

/** Expenses are recorded by whoever handles the case, and by finance. */
async function expenseCase(db: DbOrTx, actor: User, caseId: string) {
  const { c, access } = await caseWithAccess(db, actor, caseId);
  if (!access.edit && actor.role !== "finance") throw new AppError("forbidden");
  return c;
}

export async function addExpense(db: Database, actor: User, caseId: string, input: { description: string; amountCents: number; date: string; currency?: string }) {
  const c = await expenseCase(db, actor, caseId);
  const description = input.description.trim().slice(0, 300);
  const amountCents = Math.round(input.amountCents);
  if (!description || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > 100_000_000 || !DAY_RE.test(input.date)) throw new AppError("validation");
  const [e] = await db
    .insert(caseExpenses)
    .values({ caseId: c.id, description, amountCents, date: input.date, currency: (input.currency ?? "ILS").toUpperCase().slice(0, 3), createdById: actor.id })
    .returning();
  await audit(db, { actorId: actor.id, action: "case.expense", entityType: "case", entityId: c.id, details: { description, amountCents } });
  return e!;
}

export async function deleteExpense(db: Database, actor: User, id: string) {
  const [e] = await db.select().from(caseExpenses).where(eq(caseExpenses.id, id));
  if (!e) throw new AppError("not_found");
  await expenseCase(db, actor, e.caseId);
  if (e.createdById !== actor.id && !managesTime(actor) && actor.role !== "finance") throw new AppError("forbidden");
  await db.delete(caseExpenses).where(eq(caseExpenses.id, e.id));
}

// ---------------- A case's time, expenses and profit ----------------

/**
 * Time and expenses on a case. Money (revenue, cost, profit) only for admins and finance; everyone who can edit
 * the case sees the hours and expenses.
 */
export async function caseTimeSummary(db: DbOrTx, actor: User, caseId: string) {
  const { c, access } = await caseWithAccess(db, actor, caseId);
  if (!access.edit && actor.role !== "finance") throw new AppError("forbidden");
  const entries = await db
    .select({ e: timeEntries, userName: users.name, rate: users.hourlyCostCents })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(eq(timeEntries.caseId, c.id))
    .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt));
  const expenses = await db.select().from(caseExpenses).where(eq(caseExpenses.caseId, c.id)).orderBy(desc(caseExpenses.date), asc(caseExpenses.createdAt));
  const done = entries.filter((x) => x.e.minutes != null);
  const minutes = done.reduce((s, x) => s + x.e.minutes!, 0);
  const billableMinutes = done.filter((x) => x.e.billable).reduce((s, x) => s + x.e.minutes!, 0);
  const running = entries.find((x) => x.e.userId === actor.id && x.e.startedAt)?.e ?? null;
  let money: null | { currency: string; revenueCents: number; laborCents: number; expensesCents: number; profitCents: number; marginPct: number | null; unratedMinutes: number } = null;
  if (seesProfit(actor)) {
    const paid = await db
      .select({ amount: payments.amountCents, currency: payments.currency, taxRate: quotes.taxRate })
      .from(payments)
      .innerJoin(quotes, eq(quotes.id, payments.quoteId))
      .where(and(eq(payments.caseId, c.id), eq(payments.status, "succeeded")));
    const currency = paid[0]?.currency ?? expenses[0]?.currency ?? "ILS";
    // Revenue before VAT: the tax collected isn't the business's money.
    const revenueCents = paid.filter((p) => p.currency === currency).reduce((s, p) => s + Math.round((p.amount * 100) / (100 + Number(p.taxRate ?? 0))), 0);
    const laborCents = done.reduce((s, x) => s + Math.round(((x.rate ?? 0) * x.e.minutes!) / 60), 0);
    const expensesCents = expenses.filter((e) => e.currency === currency).reduce((s, e) => s + e.amountCents, 0);
    const profitCents = revenueCents - laborCents - expensesCents;
    money = {
      currency,
      revenueCents,
      laborCents,
      expensesCents,
      profitCents,
      marginPct: revenueCents > 0 ? Math.round((profitCents / revenueCents) * 1000) / 10 : null,
      // Time by people with no cost rate isn't counted in the cost; the page says so.
      unratedMinutes: done.filter((x) => x.rate == null).reduce((s, x) => s + x.e.minutes!, 0),
    };
  }
  return {
    entries: entries.map((x) => ({ id: x.e.id, userId: x.e.userId, userName: x.userName, date: x.e.date, minutes: x.e.minutes, startedAt: x.e.startedAt, note: x.e.note, billable: x.e.billable })),
    expenses: expenses.map((e) => ({ id: e.id, date: e.date, description: e.description, amountCents: e.amountCents, currency: e.currency, createdById: e.createdById })),
    minutes,
    billableMinutes,
    running: running ? { id: running.id, startedAt: running.startedAt! } : null,
    money,
    canManageAll: managesTime(actor),
  };
}

// ---------------- Cost rates (admins) ----------------

export async function setHourlyCost(db: DbOrTx, actor: User, userId: string, cents: number | null) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  if (cents !== null && (!Number.isFinite(cents) || cents < 0 || cents > 10_000_000)) throw new AppError("validation");
  const [u] = await db.update(users).set({ hourlyCostCents: cents === null ? null : Math.round(cents) }).where(eq(users.id, userId)).returning({ id: users.id, role: users.role });
  if (!u) throw new AppError("not_found");
  if (u.role === "customer") throw new AppError("validation");
  await audit(db, { actorId: actor.id, action: "user.hourly_cost", entityType: "user", entityId: userId, details: { cents } });
}

/** Timers left running for over 12 hours (forgotten): stopped at 8 hours so a night doesn't count. Run by the jobs. */
export async function closeForgottenTimers(db: DbOrTx) {
  const cutoff = new Date(Date.now() - 12 * 3600 * 1000);
  const rows = await db
    .update(timeEntries)
    .set({ minutes: 8 * 60, startedAt: null, note: sql`case when ${timeEntries.note} = '' then 'Timer stopped automatically' else ${timeEntries.note} end` })
    .where(and(isNotNull(timeEntries.startedAt), sql`${timeEntries.startedAt} < ${cutoff.toISOString()}`, isNull(timeEntries.minutes)))
    .returning({ id: timeEntries.id });
  return rows.length;
}


// ---------------- Profitability report ----------------

/**
 * Time and money for a period: hours per team member (admins and case managers), and revenue before VAT,
 * labour cost, expenses and profit per service type and per case (admins and finance). Time counts by the day it
 * was worked, payments by the day they were paid, expenses by their date.
 */
export async function buildProfitReport(db: DbOrTx, actor: User, period: { from: string; to: string }, currency: string) {
  const hoursAccess = actor.role === "admin" || actor.role === "case_manager";
  const money = seesProfit(actor);
  if (!hoursAccess && !money) return null;
  const { start, end } = bounds(period);
  const time = await db
    .select({ caseId: timeEntries.caseId, userId: timeEntries.userId, minutes: timeEntries.minutes, billable: timeEntries.billable, name: users.name, rate: users.hourlyCostCents, category: cases.serviceCategory, number: cases.number, title: cases.title })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .innerJoin(cases, eq(cases.id, timeEntries.caseId))
    .where(and(isNotNull(timeEntries.minutes), sql`${timeEntries.date} >= ${period.from}`, sql`${timeEntries.date} <= ${period.to}`));
  const members = new Map<string, { id: string; name: string; minutes: number; billableMinutes: number; cases: Set<string>; laborCents: number; rated: boolean }>();
  for (const t of time) {
    const m = members.get(t.userId) ?? { id: t.userId, name: t.name, minutes: 0, billableMinutes: 0, cases: new Set<string>(), laborCents: 0, rated: t.rate != null };
    m.minutes += t.minutes!;
    if (t.billable) m.billableMinutes += t.minutes!;
    m.cases.add(t.caseId);
    m.laborCents += Math.round(((t.rate ?? 0) * t.minutes!) / 60);
    members.set(t.userId, m);
  }
  const byMember = [...members.values()]
    .map((m) => ({ id: m.id, name: m.name, minutes: m.minutes, billableMinutes: m.billableMinutes, cases: m.cases.size, ...(money ? { laborCents: m.laborCents, rated: m.rated } : {}) }))
    .sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = byMember.reduce((s, m) => s + m.minutes, 0);
  if (!money) return { totalMinutes, byMember, money: null };

  const paid = await db
    .select({ caseId: payments.caseId, amount: payments.amountCents, taxRate: quotes.taxRate, category: cases.serviceCategory, number: cases.number, title: cases.title })
    .from(payments)
    .innerJoin(quotes, eq(quotes.id, payments.quoteId))
    .innerJoin(cases, eq(cases.id, payments.caseId))
    .where(and(eq(payments.status, "succeeded"), eq(payments.currency, currency), isNotNull(payments.paidAt), sql`${payments.paidAt} >= ${start.toISOString()}`, sql`${payments.paidAt} < ${end.toISOString()}`));
  const spent = await db
    .select({ caseId: caseExpenses.caseId, amount: caseExpenses.amountCents, category: cases.serviceCategory, number: cases.number, title: cases.title })
    .from(caseExpenses)
    .innerJoin(cases, eq(cases.id, caseExpenses.caseId))
    .where(and(eq(caseExpenses.currency, currency), sql`${caseExpenses.date} >= ${period.from}`, sql`${caseExpenses.date} <= ${period.to}`));
  type Acc = { revenueCents: number; laborCents: number; expensesCents: number; minutes: number };
  const blank = (): Acc => ({ revenueCents: 0, laborCents: 0, expensesCents: 0, minutes: 0 });
  const byCat = new Map<string, Acc & { cases: Set<string> }>();
  const byCase = new Map<string, Acc & { id: string; number: string; title: string; category: string }>();
  const touch = (r: { caseId: string; category: string; number: string; title: string }) => {
    const c = byCat.get(r.category) ?? { ...blank(), cases: new Set<string>() };
    c.cases.add(r.caseId);
    byCat.set(r.category, c);
    const k = byCase.get(r.caseId) ?? { ...blank(), id: r.caseId, number: r.number, title: r.title, category: r.category };
    byCase.set(r.caseId, k);
    return [c, k] as const;
  };
  for (const p of paid) for (const a of touch(p)) a.revenueCents += Math.round((p.amount * 100) / (100 + Number(p.taxRate ?? 0)));
  for (const t of time)
    for (const a of touch(t)) {
      a.laborCents += Math.round(((t.rate ?? 0) * t.minutes!) / 60);
      a.minutes += t.minutes!;
    }
  for (const e of spent) for (const a of touch(e)) a.expensesCents += e.amount;
  const withProfit = <T extends Acc>(a: T) => {
    const profitCents = a.revenueCents - a.laborCents - a.expensesCents;
    return { ...a, profitCents, marginPct: a.revenueCents > 0 ? Math.round((profitCents / a.revenueCents) * 1000) / 10 : null };
  };
  const byService = [...byCat].map(([category, a]) => withProfit({ category, revenueCents: a.revenueCents, laborCents: a.laborCents, expensesCents: a.expensesCents, minutes: a.minutes, cases: a.cases.size })).sort((a, b) => b.profitCents - a.profitCents);
  const cases_ = [...byCase.values()].map(withProfit);
  const totals = withProfit(cases_.reduce((s, a) => ({ revenueCents: s.revenueCents + a.revenueCents, laborCents: s.laborCents + a.laborCents, expensesCents: s.expensesCents + a.expensesCents, minutes: s.minutes + a.minutes }), blank()));
  return {
    totalMinutes,
    byMember,
    money: {
      currency,
      totals,
      byService,
      // The cases that made and lost the most (with revenue or cost in the period).
      mostProfitable: [...cases_].sort((a, b) => b.profitCents - a.profitCents).slice(0, 5),
      leastProfitable: [...cases_].filter((c) => c.laborCents + c.expensesCents > 0).sort((a, b) => a.profitCents - b.profitCents).slice(0, 5),
      unratedMembers: byMember.filter((m) => m.rated === false).map((m) => m.name),
    },
  };
}
export type ProfitReport = NonNullable<Awaited<ReturnType<typeof buildProfitReport>>>;
