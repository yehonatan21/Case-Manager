import { and, eq, inArray, is, notExists, sql } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../db";
import * as s from "../db/schema";
import { env } from "../env";

/** Accounts created by the demo seed (see db/seed.ts). */
export const DEMO_EMAILS = ["manager@example.com", "staff@example.com", "finance@example.com", "client@example.com", "biz@example.com"];
/** The seed's default administrator, used when ADMIN_EMAIL was not set at the first deploy. */
const DEFAULT_ADMIN = "admin@example.com";

export type DemoCleanupReport = {
  users: string[];
  cases: number;
  payments: number;
  intakes: number;
  references: Record<string, number>;
  applied: boolean;
};

const tables = (Object.values(s) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

/** Non-cascading foreign-key columns that point at `target` (e.g. every column referencing users.id). */
function referencesTo(target: PgTable) {
  const out: { table: PgTable; column: PgColumn; key: string; name: string }[] = [];
  for (const table of tables) {
    const cfg = getTableConfig(table);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      if (ref.foreignTable !== target || fk.onDelete === "cascade") continue;
      const column = ref.columns[0]!;
      const key = Object.keys(table).find((k) => (table as unknown as Record<string, unknown>)[k] === column)!;
      out.push({ table, column, key, name: `${cfg.name}.${column.name}` });
    }
  }
  return out;
}

/**
 * Removes the demo accounts and everything that belongs to them: the demo customers' requests (with their
 * messages, documents, quotes, payments and tasks) and their intake sessions. Real records that a demo
 * staff account touched are kept; the link to the removed account is cleared instead.
 * The seed's admin@example.com is removed too unless it is the configured ADMIN_EMAIL.
 * Runs in one transaction. With apply=false it only reports what would be removed.
 */
export async function removeDemoData(db: Database, { apply }: { apply: boolean }): Promise<DemoCleanupReport> {
  const emails = env.adminEmail === DEFAULT_ADMIN ? DEMO_EMAILS : [...DEMO_EMAILS, DEFAULT_ADMIN];
  const report: DemoCleanupReport = { users: [], cases: 0, payments: 0, intakes: 0, references: {}, applied: false };

  const run = async (tx: Database) => {
    const users = await tx.select({ id: s.users.id, email: s.users.email }).from(s.users).where(inArray(s.users.email, emails));
    report.users = users.map((u) => u.email);
    if (users.length === 0) return;
    const userIds = users.map((u) => u.id);

    const customerIds = (await tx.select({ id: s.customers.id }).from(s.customers).where(inArray(s.customers.userId, userIds))).map((c) => c.id);
    const caseIds = customerIds.length
      ? (await tx.select({ id: s.cases.id }).from(s.cases).where(inArray(s.cases.customerId, customerIds))).map((c) => c.id)
      : [];
    const paymentIds = caseIds.length ? (await tx.select({ id: s.payments.id }).from(s.payments).where(inArray(s.payments.caseId, caseIds))).map((p) => p.id) : [];
    const intakeIds = (await tx.select({ id: s.intakeSessions.id }).from(s.intakeSessions).where(inArray(s.intakeSessions.userId, userIds))).map((i) => i.id);
    report.cases = caseIds.length;
    report.payments = paymentIds.length;
    report.intakes = intakeIds.length;

    // Every link to a demo account (assignments, authorship, ...); those on records that stay are cleared.
    const userRefs = referencesTo(s.users);
    for (const ref of userRefs) {
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(ref.table).where(inArray(ref.column, userIds));
      if (row && row.n > 0) report.references[ref.name] = row.n;
    }

    if (!apply) return;

    if (paymentIds.length) {
      await tx.delete(s.paymentEvents).where(inArray(s.paymentEvents.paymentId, paymentIds));
      await tx.delete(s.payments).where(inArray(s.payments.id, paymentIds));
    }
    if (caseIds.length) {
      await tx.delete(s.aiRuns).where(inArray(s.aiRuns.caseId, caseIds));
      await tx.delete(s.cases).where(inArray(s.cases.id, caseIds)); // cascades to events, messages, documents, tasks, quotes
    }
    if (intakeIds.length) {
      await tx.delete(s.aiRuns).where(inArray(s.aiRuns.intakeSessionId, intakeIds));
      await tx.delete(s.intakeSessions).where(inArray(s.intakeSessions.id, intakeIds));
    }
    for (const ref of userRefs) {
      // A required link (customers.user_id) means the row belongs to the demo account; an optional one is cleared.
      if (ref.column.notNull) await tx.delete(ref.table).where(inArray(ref.column, userIds));
      else await tx.update(ref.table).set({ [ref.key]: null } as never).where(inArray(ref.column, userIds));
    }
    await tx.update(s.aiRuns).set({ userId: null }).where(inArray(s.aiRuns.userId, userIds));
    await tx.delete(s.users).where(inArray(s.users.id, userIds)); // cascades to customers, sessions, notifications, reads

    // The demo business customer's organisation, if nothing else uses it.
    await tx
      .delete(s.organizations)
      .where(and(eq(s.organizations.businessId, "515000000"), notExists(tx.select().from(s.customers).where(eq(s.customers.organizationId, s.organizations.id)))));
    report.applied = true;
  };

  await db.transaction(async (tx) => run(tx as unknown as Database));
  return report;
}
