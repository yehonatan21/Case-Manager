/**
 * Read-only access to the Case Manager database for the Chief of Staff scripts.
 *
 * - Postgres (DATABASE_URL / DATABASE_URL_UNPOOLED in the repository's .env): connects without migrations or
 *   seeding, and every query runs in a READ ONLY transaction.
 * - Locally without Postgres: opens a throwaway copy of the embedded database (.data/pglite), because the
 *   embedded database is single-process and the app may have it open.
 *
 * Callers load the repository's .env first (import "../lib/env"), so tests can use this without it.
 *
 * Everything returned is an aggregate. No client names, contact details or case contents leave this file;
 * team members appear by name because workload per person is what the owner asks about.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { connectDatabase, type Database, type DbOrTx } from "../../../src/lib/db";
import * as schema from "../../../src/lib/db/schema";
import { buildReport, resolvePeriod, type Period } from "../../../src/lib/services/reports";
import { dashboardMetrics } from "../../../src/lib/services/dashboard";
import { OPEN_STATUSES } from "../../../src/lib/domain";
import { zonedDay } from "../../../src/lib/meetings";
import { REPO_ROOT } from "./paths";

const { cases, caseExpenses, quotes, timeEntries, users } = schema;

/** The scripts read as an admin would (all cases, revenue included). Only the role is used by the report code. */
const AGENT_ACTOR = {
  id: "00000000-0000-0000-0000-000000000000",
  role: "admin",
  status: "active",
  name: "Chief of Staff agent",
  email: "chief-of-staff@localhost",
} as schema.User;

const HANDLER_ROLES: schema.UserRole[] = ["admin", "case_manager", "staff"];

const money = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);
const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
const r3 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1000) / 1000);
const share = (part: number, whole: number) => (whole > 0 ? r3(part / whole) : null);

// ---------------------------------------------------------------- connection

export async function openDatabase(): Promise<{ db: Database; source: string; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (url) {
    const { db, close } = await connectDatabase(url);
    return { db, source: "postgres", close };
  }
  const dir = path.resolve(REPO_ROOT, process.env.PGLITE_DIR || ".data/pglite");
  if (!fs.existsSync(dir)) {
    throw new Error(`No database found. Set DATABASE_URL in ${path.join(REPO_ROOT, ".env")}, or run the app once (npm run dev) to create ${dir}.`);
  }
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "chief-of-staff-db-"));
  fs.cpSync(dir, copy, { recursive: true });
  // A lock file copied from a running app would stop the copy from opening.
  fs.rmSync(path.join(copy, "postmaster.pid"), { force: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(copy);
  await client.waitReady;
  return {
    db: drizzle({ client, schema }) as unknown as Database,
    source: "local embedded database (.data/pglite), current as of this run (read from a copy taken just now)",
    close: async () => {
      await client.close();
      fs.rmSync(copy, { recursive: true, force: true });
    },
  };
}

/** Runs `fn` in a READ ONLY transaction: any write fails instead of changing data. */
export function inReadOnlyTransaction<T>(db: Database, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return fn(tx);
  });
}

export async function readOnly<T>(fn: (db: DbOrTx) => Promise<T>): Promise<T & { data_source: string }> {
  const { db, source, close } = await openDatabase();
  try {
    const out = await inReadOnlyTransaction(db, fn);
    return { ...out, data_source: source };
  } finally {
    await close();
  }
}

// ---------------------------------------------------------------- periods

/** The last `n` full calendar months (Israel time), oldest first, ending with last month. */
export function lastFullMonths(n: number, now = new Date()): Period {
  const [y, m] = zonedDay(now).day.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 - n, 1));
  const lastDayPrev = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: lastDayPrev.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------- snapshot

async function openQuotes(db: DbOrTx, currency: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${quotes.totalCents}), 0)::bigint`.mapWith(Number) })
    .from(quotes)
    .where(and(inArray(quotes.status, ["sent", "clarification_requested"]), eq(quotes.currency, currency)));
  return { count: row?.n ?? 0, value: money(row?.total ?? 0)! };
}

async function countOpenCases(db: DbOrTx, extra?: SQL) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(cases).where(and(inArray(cases.status, OPEN_STATUSES), extra));
  return row?.n ?? 0;
}

async function deliveryCosts(db: DbOrTx, period: Period, currency: string) {
  const time = await db
    .select({ minutes: timeEntries.minutes, billable: timeEntries.billable, userId: timeEntries.userId, hourlyCostCents: users.hourlyCostCents })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(and(gte(timeEntries.date, period.from), lte(timeEntries.date, period.to), isNotNull(timeEntries.minutes)));
  const minutes = time.reduce((a, t) => a + (t.minutes ?? 0), 0);
  const billable = time.filter((t) => t.billable).reduce((a, t) => a + (t.minutes ?? 0), 0);
  const costed = time.filter((t) => t.hourlyCostCents != null);
  const labourCents = costed.reduce((a, t) => a + ((t.minutes ?? 0) / 60) * t.hourlyCostCents!, 0);
  const [exp] = await db
    .select({ total: sql<number>`coalesce(sum(${caseExpenses.amountCents}), 0)::bigint`.mapWith(Number), n: sql<number>`count(*)::int` })
    .from(caseExpenses)
    .where(and(gte(caseExpenses.date, period.from), lte(caseExpenses.date, period.to), eq(caseExpenses.currency, currency)));
  return {
    hours_logged: r1(minutes / 60),
    billable_share: share(billable, minutes),
    labour_cost: costed.length ? money(labourCents) : null,
    people_logging_time_without_hourly_cost: new Set(time.filter((t) => t.hourlyCostCents == null).map((t) => t.userId)).size,
    case_expenses: money(exp?.total ?? 0),
    case_expense_entries: exp?.n ?? 0,
  };
}

/** The business at a glance for one period: revenue, pipeline, funnel, service times, delivery costs, team. */
export async function gatherSnapshot(db: DbOrTx, period: Period) {
  const report = await buildReport(db, AGENT_ACTOR, period);
  const now = await dashboardMetrics(db, AGENT_ACTOR);
  const currency = report.currency;
  const rev = report.revenue!;
  const f = report.funnel;
  const t = report.times;
  return {
    period: report.period,
    currency,
    amounts: "major currency units (not cents)",
    revenue: {
      total: money(rev.totalCents),
      payments: rev.count,
      average_payment: money(rev.averageCents),
      by_month: rev.byMonth.map((m) => ({ month: m.month, total: money(m.totalCents), payments: m.count })),
      by_service: rev.byService.map((s) => ({ service: s.category, total: money(s.totalCents), payments: s.count })),
      other_currencies: rev.otherCurrencies.map((o) => ({ currency: o.currency, total: money(o.totalCents), payments: o.count })),
    },
    pipeline_now: {
      new_requests: now.newRequests,
      awaiting_quote: now.awaitingQuote,
      quotes_awaiting_answer: now.quotesPending,
      open_quote_value: (await openQuotes(db, currency)).value,
      active_cases: now.activeCases,
      awaiting_client: now.awaitingClient,
      open_cases_total: await countOpenCases(db),
      unassigned_open_cases: await countOpenCases(db, isNull(cases.assigneeId)),
      waiting_on_third_party: await countOpenCases(db, eq(cases.waitingOnThirdParty, true)),
      overdue_tasks: now.overdueTasks,
    },
    funnel_for_requests_opened_in_period: {
      requests: f.requests,
      quoted: f.quoted,
      approved: f.approved,
      paid: f.paid,
      quote_rate: share(f.quoted, f.requests),
      approval_rate_of_quoted: share(f.approved, f.quoted),
      paid_rate: share(f.paid, f.requests),
    },
    service_times: {
      first_response_sla_hours: t.slaHours,
      median_first_response_hours: r1(t.medianFirstResponseHours),
      within_sla_share: r3(t.withinSlaShare),
      requests_still_awaiting_first_response: t.awaitingResponse,
      median_hours_to_quote: r1(t.medianHoursToQuote),
      median_days_to_complete: r1(t.medianDaysToComplete),
    },
    requests_by_service: report.byType.map((x) => ({ service: x.category, requests: x.count })),
    requests_by_status: report.byStatus,
    delivery_costs: await deliveryCosts(db, period, currency),
    team: (report.team ?? []).map((m) => ({
      name: m.name,
      role: m.role,
      open_cases: m.openCases,
      new_cases_in_period: m.newCases,
      completed_in_period: m.completed,
      open_tasks: m.openTasks,
      overdue_tasks: m.overdueTasks,
      meetings_in_period: m.meetings,
      median_first_response_hours: r1(m.medianFirstResponseHours),
      average_rating: r1(m.averageRating),
      ratings: m.ratings,
    })),
    satisfaction: {
      ratings: report.satisfaction.count,
      average: r1(report.satisfaction.average),
      distribution: report.satisfaction.distribution,
      cases_completed_in_period: report.satisfaction.completed,
      rating_response_rate: r3(report.satisfaction.responseRate),
    },
  };
}

// ---------------------------------------------------------------- capacity (for hiring scenarios)

/** Team size and workload now, with monthly averages over the last 90 days. */
export async function gatherCapacity(db: DbOrTx, now = new Date()) {
  const period = resolvePeriod({ preset: "90d" }, now);
  const report = await buildReport(db, AGENT_ACTOR, period);
  const handlers = await db
    .select({ id: users.id, hourlyCostCents: users.hourlyCostCents })
    .from(users)
    .where(and(inArray(users.role, HANDLER_ROLES), eq(users.status, "active"), isNull(users.deletedAt)));
  const costs = handlers.map((h) => h.hourlyCostCents).filter((c): c is number => c != null);
  const months = 3;
  const rev = report.revenue!;
  return {
    period,
    currency: report.currency,
    open_cases: await countOpenCases(db),
    handlers: handlers.length,
    handlers_with_open_cases: (report.team ?? []).filter((m) => m.role !== "finance" && m.openCases > 0).length,
    average_hourly_cost: costs.length ? money(costs.reduce((a, b) => a + b, 0) / costs.length) : null,
    handlers_without_hourly_cost: handlers.length - costs.length,
    monthly_average: {
      new_requests: r1(report.funnel.requests / months),
      completed_cases: r1(report.satisfaction.completed / months),
      revenue: money(rev.totalCents / months),
      payments: r1(rev.count / months),
    },
    average_payment: money(rev.averageCents),
    team: (report.team ?? []).map((m) => ({ name: m.name, role: m.role, open_cases: m.openCases, open_tasks: m.openTasks, overdue_tasks: m.overdueTasks })),
  };
}

// ---------------------------------------------------------------- revenue history (for forecasts)

/** Revenue per full month for the last `months` months, plus the open quote pipeline and recent approval rate. */
export async function gatherRevenueHistory(db: DbOrTx, months: number, now = new Date()) {
  const window = lastFullMonths(months, now);
  const report = await buildReport(db, AGENT_ACTOR, window);
  const recent = await buildReport(db, AGENT_ACTOR, resolvePeriod({ preset: "90d" }, now));
  const currency = report.currency;
  return {
    window,
    currency,
    history: report.revenue!.byMonth.map((m) => ({ month: m.month, total: money(m.totalCents)!, payments: m.count })),
    open_quotes: await openQuotes(db, currency),
    approval_rate_last_90_days: recent.funnel.quoted ? recent.funnel.approved / recent.funnel.quoted : null,
  };
}
