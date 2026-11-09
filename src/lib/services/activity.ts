/**
 * The activity log (admins): everything the audit trail records — who did what, when, from where — searchable by
 * person, kind of action, text and dates, a page at a time, and exportable as CSV.
 */
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { auditLogs, users, type User } from "../db/schema";
import { AppError } from "../errors";
import { zonedToUtc } from "../meetings";
import { addDays } from "../calendar-view";

export const ACTIVITY_PAGE_SIZE = 50;

export type ActivityFilter = { q?: string; actor?: string; group?: string; from?: string; to?: string; page?: number };

export type ActivityRow = {
  id: string;
  at: Date;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function where(f: ActivityFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (f.actor && /^[0-9a-f-]{36}$/i.test(f.actor)) parts.push(eq(auditLogs.actorId, f.actor));
  // A group is the part before the dot: "case", "auth", "payment"…
  if (f.group && /^[a-z_]{1,40}$/.test(f.group)) parts.push(ilike(auditLogs.action, `${f.group}.%`));
  if (f.from && DAY.test(f.from)) parts.push(gte(auditLogs.createdAt, zonedToUtc(f.from, "00:00")));
  if (f.to && DAY.test(f.to)) parts.push(lt(auditLogs.createdAt, zonedToUtc(addDays(f.to, 1), "00:00")));
  const q = f.q?.trim().slice(0, 100);
  if (q) parts.push(or(ilike(auditLogs.action, like(q)), ilike(auditLogs.entityId, like(q)), ilike(sql`${auditLogs.details}::text`, like(q)), ilike(users.name, like(q)), ilike(users.email, like(q)), ilike(auditLogs.ip, like(q)))!);
  return parts.length ? and(...parts) : undefined;
}

const select = {
  id: auditLogs.id,
  at: auditLogs.createdAt,
  action: auditLogs.action,
  actorId: auditLogs.actorId,
  actorName: users.name,
  actorEmail: users.email,
  entityType: auditLogs.entityType,
  entityId: auditLogs.entityId,
  details: auditLogs.details,
  ip: auditLogs.ip,
};

export async function listActivity(db: DbOrTx, actor: User, f: ActivityFilter) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const w = where(f);
  const [rows, [{ n } = { n: 0 }]] = await Promise.all([
    db
      .select(select)
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(w)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(ACTIVITY_PAGE_SIZE)
      .offset((page - 1) * ACTIVITY_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(w),
  ]);
  return { rows: rows as ActivityRow[], total: n, page, pages: Math.max(1, Math.ceil(n / ACTIVITY_PAGE_SIZE)) };
}

/** The kinds of action ("case", "auth"…) that appear in the log, and the people who acted, for the filters. */
export async function activityFilters(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const groups = await db.execute(sql`select distinct split_part(action, '.', 1) as g from audit_logs order by 1`);
  const people = await db
    .selectDistinct({ id: users.id, name: users.name, email: users.email })
    .from(auditLogs)
    .innerJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(users.name)
    .limit(500);
  const list = ((groups as unknown as { rows?: { g: string }[] }).rows ?? (groups as unknown as { g: string }[])).map((r) => r.g).filter(Boolean);
  return { groups: list, people };
}

/** The whole filtered log as CSV (UTF-8 with a BOM so Excel shows Hebrew), up to 20,000 rows. */
export async function activityCsv(db: DbOrTx, actor: User, f: ActivityFilter, label: (action: string) => string): Promise<string> {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const rows = (await db
    .select(select)
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where(f))
    .orderBy(desc(auditLogs.createdAt))
    .limit(20_000)) as ActivityRow[];
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Quote, and keep spreadsheet formulas from running.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const head = ["time", "action", "description", "person", "email", "entity", "entity_id", "details", "ip"];
  const lines = rows.map((r) => [r.at.toISOString(), r.action, label(r.action), r.actorName, r.actorEmail, r.entityType, r.entityId, JSON.stringify(r.details ?? {}), r.ip].map(cell).join(","));
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}
