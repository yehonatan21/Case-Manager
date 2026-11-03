import { after } from "next/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Database } from "../db";
import { notifications, users, type Case, type User } from "../db/schema";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { env } from "../env";
import { renderEmail, sendEmail } from "../email";

export type NotifyType = keyof (typeof dictionaries)["he"]["notify"];

/**
 * Creates in-app notifications and queues emails (outbox) for each recipient,
 * localized to the recipient's preferred language.
 */
export async function notify(
  db: DbOrTx,
  opts: { userIds: (string | null | undefined)[]; type: NotifyType; caseId?: string | null; vars?: Record<string, string | number>; link?: string | null; excludeUserId?: string | null },
) {
  const ids = [...new Set(opts.userIds.filter((x): x is string => !!x && x !== opts.excludeUserId))];
  if (ids.length === 0) return;
  const recipients = await db
    .select({ id: users.id, email: users.email, locale: users.locale, emailNotifications: users.emailNotifications, status: users.status })
    .from(users)
    .where(inArray(users.id, ids));
  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const r of recipients) {
    if (r.status === "disabled") continue;
    const tpl = dictionaries[(r.locale as Locale) ?? "he"].notify[opts.type];
    const title = fmt(tpl.title, opts.vars);
    const body = fmt(tpl.body, opts.vars);
    rows.push({ userId: r.id, caseId: opts.caseId ?? null, type: opts.type, channel: "in_app", title, body, link: opts.link ?? null, status: "sent", sentAt: new Date() });
    if (r.emailNotifications) {
      rows.push({ userId: r.id, caseId: opts.caseId ?? null, type: opts.type, channel: "email", toEmail: r.email, title, body, link: opts.link ?? null, status: "pending" });
    }
  }
  if (rows.length) {
    await db.insert(notifications).values(rows);
    scheduleEmailDispatch();
  }
}

/** Staff to notify about a case: the assignee, otherwise all active admins and case managers. */
export async function staffRecipients(db: DbOrTx, c: Pick<Case, "assigneeId">): Promise<string[]> {
  if (c.assigneeId) return [c.assigneeId];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ["admin", "case_manager"]), eq(users.status, "active")));
  return rows.map((r) => r.id);
}

/** Sends queued emails. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchPendingEmails(db: Database, limit = 25): Promise<number> {
  const claimed = await db.execute(sql`
    update notifications set attempts = attempts + 1
    where id in (
      select id from notifications
      where channel = 'email' and status = 'pending' and attempts < 5
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, user_id, to_email, title, body, link, attempts`);
  const list = (claimed as unknown as { rows: Record<string, unknown>[] }).rows ?? (claimed as unknown as Record<string, unknown>[]);
  let sent = 0;
  for (const n of list) {
    const [u] = await db.select({ name: users.name, locale: users.locale }).from(users).where(eq(users.id, n.user_id as string));
    const locale = (u?.locale as Locale) ?? "he";
    const d = dictionaries[locale];
    const { text, html } = renderEmail({
      locale,
      greeting: fmt(d.email.greeting, { name: u?.name ?? "" }),
      title: String(n.title),
      body: String(n.body ?? ""),
      link: (n.link as string) ?? null,
      linkLabel: d.email.openLink,
      footer: fmt(d.email.footer, { app: env.appName }),
    });
    try {
      await sendEmail({ to: String(n.to_email), subject: String(n.title), text, html });
      await db.update(notifications).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(notifications.id, n.id as string));
      sent++;
    } catch (err) {
      const attempts = Number(n.attempts ?? 1);
      await db
        .update(notifications)
        .set({ status: attempts >= 5 ? "failed" : "pending", error: String(err).slice(0, 500) })
        .where(eq(notifications.id, n.id as string));
    }
  }
  return sent;
}

export function scheduleEmailDispatch() {
  if (env.isTest) return;
  const run = async () => {
    try {
      await dispatchPendingEmails(await getDb());
    } catch (err) {
      console.error("[notifications] dispatch failed", err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function listNotifications(db: DbOrTx, user: Pick<User, "id">, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.channel, "in_app")))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(db: DbOrTx, user: Pick<User, "id">) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.channel, "in_app"), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function markNotificationsRead(db: DbOrTx, user: Pick<User, "id">, ids?: string[]) {
  const where = ids?.length
    ? and(eq(notifications.userId, user.id), inArray(notifications.id, ids), isNull(notifications.readAt))
    : and(eq(notifications.userId, user.id), eq(notifications.channel, "in_app"), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date(), status: "read" }).where(where);
}

export async function markCaseNotificationsRead(db: DbOrTx, userId: string, caseId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date(), status: "read" })
    .where(and(eq(notifications.userId, userId), eq(notifications.caseId, caseId), eq(notifications.channel, "in_app"), isNull(notifications.readAt)));
}
