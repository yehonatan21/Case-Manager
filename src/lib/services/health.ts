import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { aiRuns, calendarConnections, invoices, notifications, payments, paymentEvents, settings, type User } from "../db/schema";
import { env } from "../env";
import { getAiProvider } from "../ai/providers";
import { AppError } from "../errors";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { getWhatsAppStatus, dispatchPendingWhatsApp } from "./whatsapp";
import { getPaymentProviderStatus } from "./payment-settings";
import { getInvoiceStatus, dispatchPendingInvoices } from "./invoices";
import { googleEnabled } from "./google";
import { dispatchPendingEmails } from "./notifications";
import { dispatchPendingPushes } from "./push";

export type HealthLevel = "ok" | "warning" | "error" | "off";
export type RetryKind = "email" | "whatsapp" | "push" | "invoices";
/** Problems the page explains (texts in d.health.issues). */
export type HealthIssue =
  | "ai_offline"
  | "ai_data_allowed"
  | "ai_free_model"
  | "ai_check_terms"
  | "ai_failing"
  | "email_console"
  | "delivery_failing"
  | "delivery_stuck"
  | "payments_test_only"
  | "payments_failing"
  | "invoices_failing"
  | "jobs_never"
  | "jobs_late"
  | "a11y_contact_missing"
  | "company_defaults"
  | "demo_mode";

export type HealthStats = { lastOkAt: string | null; lastFailedAt: string | null; lastError: string | null; failed7d: number; stuck: number };
export type HealthCheck = {
  id: "ai" | "email" | "whatsapp" | "push" | "payments" | "invoices" | "calendar" | "jobs" | "setup";
  level: HealthLevel;
  issues: HealthIssue[];
  /** Plain facts shown on the card (provider, model...). Never secrets. */
  facts: Record<string, string | number | boolean | null>;
  stats?: HealthStats;
  retry?: RetryKind;
};

const JOBS_KEY = "jobs.last_run";
const DAY = 24 * 3600 * 1000;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const worst = (levels: HealthLevel[]): HealthLevel => (levels.includes("error") ? "error" : levels.includes("warning") ? "warning" : levels.includes("ok") ? "ok" : "off");

/** Kept by the jobs run, so the health page can tell whether the scheduled jobs are running. */
export async function recordJobsRun(db: DbOrTx, result: Record<string, number>) {
  const value = { at: new Date().toISOString(), result };
  await db.insert(settings).values({ key: JOBS_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function channelStats(db: DbOrTx, channel: "email" | "whatsapp" | "push"): Promise<HealthStats> {
  const since = new Date(Date.now() - 7 * DAY);
  const [okRow] = await db.select({ at: sql<string | null>`max(${notifications.sentAt})` }).from(notifications).where(and(eq(notifications.channel, channel), eq(notifications.status, "sent")));
  const [failRow] = await db
    .select({ at: notifications.createdAt, error: notifications.error })
    .from(notifications)
    .where(and(eq(notifications.channel, channel), eq(notifications.status, "failed")))
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  const [counts] = await db
    .select({
      failed: sql<number>`count(*) filter (where ${notifications.status} = 'failed' and ${notifications.createdAt} >= ${since.toISOString()})::int`,
      stuck: sql<number>`count(*) filter (where ${notifications.status} = 'pending' and ${notifications.createdAt} < ${new Date(Date.now() - 30 * 60 * 1000).toISOString()})::int`,
    })
    .from(notifications)
    .where(eq(notifications.channel, channel));
  return { lastOkAt: iso(okRow?.at), lastFailedAt: iso(failRow?.at), lastError: failRow?.error ?? null, failed7d: counts?.failed ?? 0, stuck: counts?.stuck ?? 0 };
}

/** ok / warning / error from delivery numbers: failing now (the latest attempt failed) is an error. */
function deliveryLevel(st: HealthStats, issues: HealthIssue[]): HealthLevel {
  if (st.stuck > 0) issues.push("delivery_stuck");
  if (st.failed7d > 0) {
    issues.push("delivery_failing");
    if (!st.lastOkAt || (st.lastFailedAt && st.lastFailedAt > st.lastOkAt)) return "error";
    return "warning";
  }
  return st.stuck > 0 ? "warning" : "ok";
}

function aiCheck(): Omit<HealthCheck, "stats"> {
  const ai = getAiProvider();
  const issues: HealthIssue[] = [];
  if (!ai) return { id: "ai", level: "warning", issues: ["ai_offline"], facts: { provider: "offline" } };
  const facts: HealthCheck["facts"] = { provider: ai.id, model: ai.model };
  let level: HealthLevel = "ok";
  if (ai.id === "openrouter") {
    facts.dataCollection = env.openrouterDataCollection;
    if (env.openrouterDataCollection === "allow") {
      issues.push("ai_data_allowed");
      level = "error";
    }
    if (/:free$/.test(env.openrouterModel) || env.openrouterFallbackModels.some((m) => /:free$/.test(m))) {
      issues.push("ai_free_model");
      if (level === "ok") level = "warning";
    }
  } else if (ai.id === "openai-compatible") {
    issues.push("ai_check_terms");
    level = "warning";
  }
  return { id: "ai", level, issues, facts };
}

/** The state of every integration and background job, for the admins' System health page. */
export async function getSystemHealth(db: Database, actor: User): Promise<{ level: HealthLevel; checks: HealthCheck[]; checkedAt: string }> {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();
  const checks: HealthCheck[] = [];

  // AI: provider and privacy, plus recent failures (which fall back to the offline engine).
  const ai = aiCheck();
  const [aiOk] = await db.select({ at: sql<string | null>`max(${aiRuns.createdAt})` }).from(aiRuns).where(eq(aiRuns.status, "ok"));
  const [aiFail] = await db.select({ at: aiRuns.createdAt, error: aiRuns.error }).from(aiRuns).where(inArray(aiRuns.status, ["error", "fallback"])).orderBy(desc(aiRuns.createdAt)).limit(1);
  const [aiCount] = await db.select({ n: sql<number>`count(*)::int` }).from(aiRuns).where(and(inArray(aiRuns.status, ["error", "fallback"]), gte(aiRuns.createdAt, new Date(since7))));
  const aiStats: HealthStats = { lastOkAt: iso(aiOk?.at), lastFailedAt: iso(aiFail?.at), lastError: aiFail?.error ?? null, failed7d: aiCount?.n ?? 0, stuck: 0 };
  if (ai.facts.provider !== "offline" && aiStats.failed7d > 0 && (!aiStats.lastOkAt || (aiStats.lastFailedAt ?? "") > aiStats.lastOkAt)) {
    ai.issues.push("ai_failing");
    if (ai.level !== "error") ai.level = "warning";
  }
  checks.push({ ...ai, stats: aiStats });

  // Email.
  {
    const issues: HealthIssue[] = [];
    const stats = await channelStats(db, "email");
    let level: HealthLevel;
    if (env.emailProvider === "console") {
      // Without SMTP nothing leaves the server: fine on a laptop or a demo, broken for real clients.
      if (env.isProd && !env.demoMode) {
        issues.push("email_console");
        level = "error";
      } else level = "off";
    } else level = deliveryLevel(stats, issues);
    checks.push({ id: "email", level, issues, facts: { provider: env.emailProvider }, stats, retry: env.emailProvider === "console" ? undefined : "email" });
  }

  // WhatsApp.
  {
    const st = await getWhatsAppStatus(db);
    if (!st.connected) checks.push({ id: "whatsapp", level: "off", issues: [], facts: { connected: false } });
    else {
      const issues: HealthIssue[] = [];
      const stats = await channelStats(db, "whatsapp");
      checks.push({ id: "whatsapp", level: deliveryLevel(stats, issues), issues, facts: { connected: true, phone: st.displayPhone }, stats, retry: "whatsapp" });
    }
  }

  // Web Push (expired devices fail and are removed; only a run of failures matters).
  {
    const issues: HealthIssue[] = [];
    const stats = await channelStats(db, "push");
    const level = stats.lastOkAt || stats.failed7d || stats.stuck ? deliveryLevel(stats, issues) : "off";
    checks.push({ id: "push", level, issues, facts: {}, stats, retry: "push" });
  }

  // Payments.
  {
    const st = await getPaymentProviderStatus(db);
    const issues: HealthIssue[] = [];
    let level: HealthLevel = "ok";
    if (st.active === "mock") {
      issues.push("payments_test_only");
      level = env.isProd && !env.demoMode ? "error" : "warning";
    }
    const [paid] = await db.select({ at: sql<string | null>`max(${payments.paidAt})` }).from(payments).where(eq(payments.status, "succeeded"));
    const [fail] = await db.select({ at: payments.updatedAt, error: payments.failureReason }).from(payments).where(eq(payments.status, "failed")).orderBy(desc(payments.updatedAt)).limit(1);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.status, "failed"), gte(payments.updatedAt, new Date(since7))));
    const [hook] = await db.select({ at: sql<string | null>`max(${paymentEvents.createdAt})` }).from(paymentEvents);
    const stats: HealthStats = { lastOkAt: iso(paid?.at), lastFailedAt: iso(fail?.at), lastError: fail?.error ?? null, failed7d: cnt?.n ?? 0, stuck: 0 };
    // A declined card is normal; many failures with no success since may mean the connection is broken.
    if (stats.failed7d >= 3 && (!stats.lastOkAt || (stats.lastFailedAt ?? "") > stats.lastOkAt)) {
      issues.push("payments_failing");
      if (level === "ok") level = "warning";
    }
    checks.push({ id: "payments", level, issues, facts: { provider: st.active, sandbox: st.active === "grow" ? st.grow.sandbox : null, lastWebhookAt: iso(hook?.at) }, stats });
  }

  // Receipts and invoices.
  {
    const st = await getInvoiceStatus(db);
    const issues: HealthIssue[] = [];
    const [ok] = await db.select({ at: sql<string | null>`max(${invoices.issuedAt})` }).from(invoices).where(eq(invoices.status, "issued"));
    const [fail] = await db.select({ at: invoices.createdAt, error: invoices.error }).from(invoices).where(eq(invoices.status, "failed")).orderBy(desc(invoices.createdAt)).limit(1);
    const [cnt] = await db
      .select({
        failed: sql<number>`count(*) filter (where ${invoices.status} = 'failed')::int`,
        stuck: sql<number>`count(*) filter (where ${invoices.status} = 'pending' and ${invoices.createdAt} < ${new Date(Date.now() - 30 * 60 * 1000).toISOString()})::int`,
      })
      .from(invoices);
    const stats: HealthStats = { lastOkAt: iso(ok?.at), lastFailedAt: iso(fail?.at), lastError: fail?.error ?? null, failed7d: cnt?.failed ?? 0, stuck: cnt?.stuck ?? 0 };
    let level: HealthLevel = "ok";
    if (stats.failed7d > 0) {
      issues.push("invoices_failing");
      level = "error";
    } else if (stats.stuck > 0) {
      issues.push("delivery_stuck");
      level = "warning";
    }
    checks.push({ id: "invoices", level, issues, facts: { provider: st.connected ? (st.provider ?? "greeninvoice") : "confirmation", sandbox: st.connected ? st.sandbox : null, business: st.businessName }, stats, retry: "invoices" });
  }

  // Google Calendar.
  {
    const available = googleEnabled();
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(calendarConnections);
    checks.push({ id: "calendar", level: available && (cnt?.n ?? 0) > 0 ? "ok" : "off", issues: [], facts: { available, connections: cnt?.n ?? 0 } });
  }

  // Scheduled jobs: retries, reminders and expiring quotes depend on them.
  {
    const [row] = await db.select().from(settings).where(eq(settings.key, JOBS_KEY));
    const last = (row?.value as { at?: string } | undefined)?.at ?? null;
    const issues: HealthIssue[] = [];
    let level: HealthLevel = "ok";
    if (!last) {
      issues.push("jobs_never");
      level = "warning";
    } else if (Date.now() - new Date(last).getTime() > 2 * 3600 * 1000) {
      issues.push("jobs_late");
      level = Date.now() - new Date(last).getTime() > 26 * 3600 * 1000 ? "error" : "warning";
    }
    checks.push({ id: "jobs", level, issues, facts: { lastRunAt: last } });
  }

  // Setup that the public pages depend on.
  {
    const s = await getSettings(db);
    const issues: HealthIssue[] = [];
    if (!s.accessibility_contact.name.trim()) issues.push("a11y_contact_missing");
    if (/@example\.com$/i.test(s.company.email) || s.company.phone === "03-0000000") issues.push("company_defaults");
    let level: HealthLevel = issues.length ? "warning" : "ok";
    // Demo mode is meant for previews and demos; on the live Vercel site it lets anyone in as anyone.
    if (env.demoMode && process.env.VERCEL_ENV === "production") {
      issues.push("demo_mode");
      level = "error";
    }
    checks.push({ id: "setup", level, issues, facts: {} });
  }

  return { level: worst(checks.map((c) => c.level)), checks, checkedAt: new Date().toISOString() };
}

/**
 * Puts failed messages (last 7 days) or failed invoices back in the queue and sends them now.
 * Returns how many were queued again and how many went out.
 */
export async function retryFailed(db: Database, actor: User, kind: RetryKind): Promise<{ requeued: number; sent: number }> {
  if (actor.role !== "admin") throw new AppError("forbidden");
  let requeued = 0;
  let sent = 0;
  if (kind === "invoices") {
    const rows = await db.update(invoices).set({ status: "pending", attempts: 0, error: null }).where(eq(invoices.status, "failed")).returning({ id: invoices.id });
    requeued = rows.length;
    if (requeued) sent = await dispatchPendingInvoices(db, Math.max(requeued, 20));
  } else {
    const rows = await db
      .update(notifications)
      .set({ status: "pending", attempts: 0, error: null })
      .where(and(eq(notifications.channel, kind), eq(notifications.status, "failed"), gte(notifications.createdAt, new Date(Date.now() - 7 * DAY))))
      .returning({ id: notifications.id });
    // Older failures are left alone: a week-old reminder isn't worth sending now.
    requeued = rows.length;
    if (requeued) {
      const n = Math.max(requeued, 25);
      sent = kind === "email" ? await dispatchPendingEmails(db, n) : kind === "whatsapp" ? await dispatchPendingWhatsApp(db, n) : await dispatchPendingPushes(db, n);
    }
  }
  await audit(db, { actorId: actor.id, action: "health.retry", entityType: "settings", details: { kind, requeued, sent } });
  return { requeued, sent };
}
