import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { replyTemplates, type User } from "../db/schema";
import { AppError } from "../errors";
import { staffCaseScope } from "./cases";
import { likeTerm } from "./customers";
import { audit } from "./audit";

export const CONVERSATION_FILTERS = ["needs_reply", "mine", "unassigned", "all"] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];
export const CONVERSATIONS_PAGE_SIZE = 30;

export type ConversationRow = {
  caseId: string;
  number: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  customerName: string;
  customerLocale: string;
  lastBody: string;
  lastAt: string;
  lastVia: string | null;
  /** The last message is the client's: the team owes an answer. */
  fromClient: boolean;
  /** The client wrote after this user last opened the case. */
  unread: boolean;
  messageCount: number;
};

const rowsOf = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[])) as Record<string, unknown>[];

/**
 * Client conversations across cases (messages in the app and on WhatsApp), the latest first, for the shared
 * Conversations inbox. Only cases the user may see.
 */
export async function listConversations(db: DbOrTx, actor: User, opts: { filter?: string; q?: string; page?: number } = {}) {
  const filter: ConversationFilter = (CONVERSATION_FILTERS as readonly string[]).includes(opts.filter ?? "") ? (opts.filter as ConversationFilter) : "needs_reply";
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const where = conditions(actor, filter, opts.q);
  const result = await db.execute(sql`
    select cases.id as case_id, cases.number, cases.title, cases.status, cases.assignee_id,
      (select name from users a where a.id = cases.assignee_id) as assignee_name,
      cu_user.name as customer_name, cu_user.locale as customer_locale,
      lm.body as last_body, lm.created_at as last_at, lm.via as last_via, lm.from_client,
      (lm.from_client and (cr.last_read_at is null or cr.last_read_at < lm.created_at)) as unread,
      (select count(*)::int from messages m2 where m2.case_id = cases.id and m2.kind = 'thread') as message_count
    from cases
    join customers on customers.id = cases.customer_id
    join users cu_user on cu_user.id = customers.user_id
    join lateral (
      select m.body, m.created_at, m.via, coalesce(m.sender_id = customers.user_id, false) as from_client
      from messages m where m.case_id = cases.id and m.kind = 'thread'
      order by m.created_at desc limit 1
    ) lm on true
    left join case_reads cr on cr.case_id = cases.id and cr.user_id = ${actor.id}
    where ${where}
    order by lm.from_client desc, lm.created_at desc
    limit ${CONVERSATIONS_PAGE_SIZE + 1} offset ${(page - 1) * CONVERSATIONS_PAGE_SIZE}`);
  const list = rowsOf(result).map(
    (r): ConversationRow => ({
      caseId: String(r.case_id),
      number: String(r.number),
      title: String(r.title),
      status: String(r.status),
      assigneeId: (r.assignee_id as string | null) ?? null,
      assigneeName: (r.assignee_name as string | null) ?? null,
      customerName: String(r.customer_name),
      customerLocale: String(r.customer_locale ?? "he"),
      lastBody: String(r.last_body ?? ""),
      lastAt: new Date(r.last_at as string).toISOString(),
      lastVia: (r.last_via as string | null) ?? null,
      fromClient: !!r.from_client,
      unread: !!r.unread,
      messageCount: Number(r.message_count ?? 0),
    }),
  );
  // "Needs an answer" first, then the newest; within the list the order is kept.
  return { filter, page, rows: list.slice(0, CONVERSATIONS_PAGE_SIZE), hasNext: list.length > CONVERSATIONS_PAGE_SIZE };
}

function conditions(actor: User, filter: ConversationFilter, q?: string): SQL {
  const parts: SQL[] = [sql`true`];
  const scope = staffCaseScope(actor);
  if (scope) parts.push(scope);
  if (filter === "needs_reply") parts.push(sql`lm.from_client`);
  if (filter === "mine") parts.push(sql`cases.assignee_id = ${actor.id}`);
  if (filter === "unassigned") parts.push(sql`cases.assignee_id is null`);
  if (q?.trim()) {
    const like = likeTerm(q);
    parts.push(sql`(cases.number ilike ${like} or cases.title ilike ${like} or cu_user.name ilike ${like} or cu_user.email ilike ${like} or exists (select 1 from messages m3 where m3.case_id = cases.id and m3.kind = 'thread' and m3.body ilike ${like}))`);
  }
  return sql.join(parts, sql` and `);
}

/** How many conversations wait for an answer (for the navigation badge and the tab). */
export async function conversationCounts(db: DbOrTx, actor: User): Promise<Record<ConversationFilter, number>> {
  const scope = staffCaseScope(actor);
  const result = await db.execute(sql`
    select
      count(*) filter (where lm.from_client)::int as needs_reply,
      count(*) filter (where cases.assignee_id = ${actor.id})::int as mine,
      count(*) filter (where cases.assignee_id is null)::int as unassigned,
      count(*)::int as all_count
    from cases
    join customers on customers.id = cases.customer_id
    join lateral (
      select coalesce(m.sender_id = customers.user_id, false) as from_client from messages m
      where m.case_id = cases.id and m.kind = 'thread' order by m.created_at desc limit 1
    ) lm on true
    where ${scope ?? sql`true`}`);
  const r = rowsOf(result)[0] ?? {};
  return { needs_reply: Number(r.needs_reply ?? 0), mine: Number(r.mine ?? 0), unassigned: Number(r.unassigned ?? 0), all: Number(r.all_count ?? 0) };
}

/** The menu's Conversations counter: conversations whose latest message is the client's (they wait for an answer). */
export async function awaitingReplyCount(db: DbOrTx, actor: User): Promise<number> {
  const scope = staffCaseScope(actor);
  const result = await db.execute(sql`
    select count(*)::int as n
    from cases
    join customers on customers.id = cases.customer_id
    join lateral (
      select coalesce(m.sender_id = customers.user_id, false) as from_client from messages m
      where m.case_id = cases.id and m.kind = 'thread' order by m.created_at desc limit 1
    ) lm on true
    where lm.from_client and ${scope ?? sql`true`}`);
  return Number(rowsOf(result)[0]?.n ?? 0);
}

// ---------------- Saved replies ----------------

export type ReplyTemplateInput = { title: string; bodyHe: string; bodyEn: string };

const canManage = (actor: User) => actor.role === "admin" || actor.role === "case_manager";

export async function listReplyTemplates(db: DbOrTx) {
  return db.select().from(replyTemplates).orderBy(asc(replyTemplates.title));
}

function cleanTemplate(input: ReplyTemplateInput) {
  const title = input.title.trim().slice(0, 120);
  const bodyHe = input.bodyHe.trim().slice(0, 4000);
  const bodyEn = input.bodyEn.trim().slice(0, 4000);
  if (!title || (!bodyHe && !bodyEn)) throw new AppError("validation");
  return { title, bodyHe, bodyEn };
}

export async function createReplyTemplate(db: DbOrTx, actor: User, input: ReplyTemplateInput) {
  if (!canManage(actor)) throw new AppError("forbidden");
  const [r] = await db.insert(replyTemplates).values({ ...cleanTemplate(input), createdById: actor.id }).returning();
  await audit(db, { actorId: actor.id, action: "reply_template.create", entityType: "settings", details: { id: r!.id, title: r!.title } });
  return r!;
}

export async function updateReplyTemplate(db: DbOrTx, actor: User, id: string, input: ReplyTemplateInput) {
  if (!canManage(actor)) throw new AppError("forbidden");
  const [r] = await db.update(replyTemplates).set({ ...cleanTemplate(input), updatedAt: new Date() }).where(eq(replyTemplates.id, id)).returning();
  if (!r) throw new AppError("not_found");
  return r;
}

export async function deleteReplyTemplate(db: DbOrTx, actor: User, id: string) {
  if (!canManage(actor)) throw new AppError("forbidden");
  const rows = await db.delete(replyTemplates).where(and(eq(replyTemplates.id, id))).returning({ id: replyTemplates.id });
  if (rows.length === 0) throw new AppError("not_found");
}

/** A saved reply in the client's language, with {client} and {number} filled in. */
export function fillReply(t: { bodyHe: string; bodyEn: string }, locale: string, vars: { client: string; number: string }) {
  const body = locale === "en" ? t.bodyEn || t.bodyHe : t.bodyHe || t.bodyEn;
  return body.replace(/\{(client|number)\}/g, (_, k: "client" | "number") => vars[k]);
}
