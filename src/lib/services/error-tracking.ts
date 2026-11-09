/**
 * Error tracking without an outside service: errors on the server (API routes, pages) and in browsers are stored,
 * grouped (the same error from the same place is one entry with a count), shown to admins in Settings → System
 * health, and a new one notifies the admins (in the app and by email). Personal data is trimmed from messages.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { errorEvents, users, type User } from "../db/schema";
import { AppError } from "../errors";
import { sha256 } from "../crypto";
import { notify } from "./notifications";

export type ErrorReport = { source: "server" | "browser"; message: string; stack?: string | null; path?: string | null; userId?: string | null };

/** Emails, long numbers (phones, ids) and tokens out of a message, and the same shape for grouping. */
export function scrub(s: string): string {
  return s
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b(?:sk|re|pk|ghp|xox[bp])[-_][A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/\d{7,}/g, "[number]");
}

/** The same error from the same place: the message without changing parts, and the first line of the stack that's our code. */
export function fingerprint(r: Pick<ErrorReport, "source" | "message" | "stack">): string {
  const msg = scrub(r.message).replace(/\d+/g, "N").slice(0, 300);
  const frame = (r.stack ?? "").split("\n").find((l) => /at |@/.test(l) && !/node_modules|node:internal/.test(l)) ?? "";
  const where = frame.replace(/:\d+:\d+\)?$/, "").replace(/\?[^)\s]*/, "").trim();
  return sha256(`${r.source}|${msg}|${where}`);
}

/** Stores an error; a new kind tells the admins. Never throws (tracking must not cause errors of its own). */
export async function recordError(db: DbOrTx, r: ErrorReport): Promise<void> {
  try {
    const message = scrub(String(r.message || "Unknown error")).slice(0, 500);
    const stack = r.stack ? scrub(r.stack).split("\n").slice(0, 20).join("\n").slice(0, 4000) : null;
    const path = r.path ? r.path.split("?")[0]!.slice(0, 300) : null;
    const fp = fingerprint({ source: r.source, message, stack });
    const userId = r.userId && /^[0-9a-f-]{36}$/i.test(r.userId) ? r.userId : null;
    const [open] = await db.select().from(errorEvents).where(and(eq(errorEvents.fingerprint, fp), isNull(errorEvents.resolvedAt))).limit(1);
    if (open) {
      await db
        .update(errorEvents)
        .set({ count: sql`${errorEvents.count} + 1`, lastSeenAt: new Date(), lastUserId: userId ?? open.lastUserId, path: path ?? open.path })
        .where(eq(errorEvents.id, open.id));
      return;
    }
    await db.insert(errorEvents).values({ fingerprint: fp, source: r.source, message, stack, path, lastUserId: userId });
    // A new error (or one that came back after being marked fixed): tell the admins, at most once an hour per kind.
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(errorEvents)
      .where(and(eq(errorEvents.fingerprint, fp), gte(errorEvents.firstSeenAt, new Date(Date.now() - 3600_000))));
    if ((recent?.n ?? 0) > 1) return;
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    await notify(db, { userIds: admins.map((a) => a.id), type: "error_new", vars: { message: message.slice(0, 140), where: path ?? r.source }, link: "/admin/settings?tab=health#errors" });
  } catch (err) {
    console.error("[errors] could not record an error", err);
  }
}

export async function listErrors(db: DbOrTx, actor: User, opts: { includeResolved?: boolean } = {}) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  return db
    .select()
    .from(errorEvents)
    .where(opts.includeResolved ? undefined : isNull(errorEvents.resolvedAt))
    .orderBy(desc(errorEvents.lastSeenAt))
    .limit(100);
}

/** Marks errors as fixed; if one happens again it comes back as new. */
export async function resolveErrors(db: DbOrTx, actor: User, ids: string[] | "all") {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const valid = ids === "all" ? null : ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid && valid.length === 0) return 0;
  const r = await db
    .update(errorEvents)
    .set({ resolvedAt: new Date() })
    .where(and(isNull(errorEvents.resolvedAt), ...(valid ? [inArray(errorEvents.id, valid)] : [])))
    .returning({ id: errorEvents.id });
  return r.length;
}

/** For System health: open errors, and how many happened in the last 24 hours. */
export async function errorSummary(db: DbOrTx) {
  const [row] = await db
    .select({
      open: sql<number>`count(*)::int`,
      recent: sql<number>`count(*) filter (where ${errorEvents.lastSeenAt} > now() - interval '24 hours')::int`,
      lastAt: sql<Date | null>`max(${errorEvents.lastSeenAt})`,
    })
    .from(errorEvents)
    .where(isNull(errorEvents.resolvedAt));
  return { open: row?.open ?? 0, recent: row?.recent ?? 0, lastAt: row?.lastAt ? new Date(row.lastAt) : null };
}
