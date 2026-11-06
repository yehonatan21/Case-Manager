import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import {
  automationRules,
  caseEvents,
  caseStatusEnum,
  cases,
  customers,
  messages,
  tasks,
  users,
  type AutomationAction,
  type AutomationRule,
  type AutomationTrigger,
  type Case,
  type User,
} from "../db/schema";
import { AppError } from "../errors";
import { addDaysIso, truncate } from "../utils";
import { notify } from "./notifications";
import { audit } from "./audit";

export const AUTOMATION_TRIGGERS: AutomationTrigger[] = ["case_submitted", "documents_complete", "quote_approved", "payment_succeeded", "status_changed", "milestone_completed"];

/** Which case events start which rules (a status change is any of the three status events). */
export const EVENT_TRIGGERS: Record<string, AutomationTrigger> = {
  case_submitted: "case_submitted",
  case_opened_by_staff: "case_submitted",
  documents_complete: "documents_complete",
  quote_approved: "quote_approved",
  payment_succeeded: "payment_succeeded",
  status_changed: "status_changed",
  case_completed: "status_changed",
  case_closed: "status_changed",
  milestone_completed: "milestone_completed",
};

/** {client}, {number} and {title} in a rule's texts. */
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(client|number|title|milestone)\}/g, (_, k: string) => vars[k] ?? "");

/**
 * Runs the active rules for something that just happened on a case, inside the same transaction.
 * Rule actions write their own history directly, so they never start other rules (no loops).
 */
export async function runRules(db: DbOrTx, trigger: AutomationTrigger, caseId: string, data: Record<string, unknown> = {}) {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.active, true), eq(automationRules.trigger, trigger)))
    .orderBy(asc(automationRules.createdAt));
  if (rules.length === 0) return 0;
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) return 0;
  const to = trigger === "status_changed" ? String(data.to ?? c.status) : null;
  const matching = rules.filter((r) => (!r.category || r.category === c.serviceCategory) && (trigger !== "status_changed" || !r.triggerStatus || r.triggerStatus === to));
  if (matching.length === 0) return 0;
  const [cu] = await db
    .select({ id: users.id, name: users.name, locale: users.locale })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, c.customerId));
  const vars = { client: cu?.name ?? "", number: c.number, title: c.title, milestone: typeof data.milestone === "string" ? data.milestone : "" };
  for (const r of matching) {
    await apply(db, r, c, cu ?? null, vars);
    await db.update(automationRules).set({ runCount: sql`${automationRules.runCount} + 1`, lastRunAt: new Date() }).where(eq(automationRules.id, r.id));
    await db.insert(caseEvents).values({ caseId: c.id, type: "rule_applied", actorKind: "system", visibility: "internal", data: { rule: r.name } });
  }
  return matching.length;
}

async function apply(db: DbOrTx, r: AutomationRule, c: Case, client: { id: string; locale: string } | null, vars: Record<string, string>) {
  const a = r.action;
  if (a.type === "create_task") {
    const [{ max } = { max: 0 }] = await db.select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), 0)::int` }).from(tasks).where(eq(tasks.caseId, c.id));
    const [t] = await db
      .insert(tasks)
      .values({ caseId: c.id, title: fill(a.title, vars).slice(0, 300), assigneeId: c.assigneeId, dueDate: a.dueInDays != null ? addDaysIso(a.dueInDays) : null, priority: a.priority ?? "normal", sortOrder: max + 1 })
      .returning();
    if (c.assigneeId) await notify(db, { userIds: [c.assigneeId], type: "task_assigned", caseId: c.id, vars: { title: t!.title, number: c.number }, link: `/admin/cases/${c.id}?tab=tasks` });
  } else if (a.type === "notify_owner") {
    // The handler, or the admins when nobody handles the case yet.
    const to = c.assigneeId ? [c.assigneeId] : (await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.id);
    await notify(db, { userIds: to, type: "rule_notice", caseId: c.id, vars: { number: c.number, text: truncate(fill(a.text, vars), 200) }, link: `/admin/cases/${c.id}` });
  } else if (a.type === "message_client" && client) {
    const body = fill(client.locale === "en" ? a.en || a.he : a.he || a.en, vars).trim();
    if (!body) return;
    // An automatic message: no team member is shown as its author.
    const [m] = await db.insert(messages).values({ caseId: c.id, senderId: null, kind: "thread", body: body.slice(0, 5000), via: "automation" }).returning();
    await db.insert(caseEvents).values({ caseId: c.id, type: "client_update", actorKind: "system", visibility: "internal", data: { messageId: m!.id } });
    await notify(db, { userIds: [client.id], type: "new_message", caseId: c.id, vars: { number: c.number, preview: truncate(body, 140) }, link: `/portal/cases/${c.id}` });
  }
}

// ---------------- Managing rules (admins) ----------------

export type RuleInput = { name: string; active: boolean; trigger: AutomationTrigger; triggerStatus?: string | null; category?: string | null; action: AutomationAction };

function clean(input: RuleInput) {
  const name = input.name.trim().slice(0, 120);
  if (!name || !AUTOMATION_TRIGGERS.includes(input.trigger)) throw new AppError("validation");
  const triggerStatus = input.trigger === "status_changed" && input.triggerStatus && (caseStatusEnum.enumValues as readonly string[]).includes(input.triggerStatus) ? input.triggerStatus : null;
  const a = input.action;
  let action: AutomationAction;
  if (a.type === "create_task") {
    if (!a.title.trim()) throw new AppError("validation");
    action = { type: "create_task", title: a.title.trim().slice(0, 300), dueInDays: a.dueInDays != null && a.dueInDays >= 0 ? Math.min(Math.round(a.dueInDays), 365) : null, priority: a.priority ?? "normal" };
  } else if (a.type === "notify_owner") {
    if (!a.text.trim()) throw new AppError("validation");
    action = { type: "notify_owner", text: a.text.trim().slice(0, 500) };
  } else if (a.type === "message_client") {
    if (!a.he.trim() && !a.en.trim()) throw new AppError("validation");
    action = { type: "message_client", he: a.he.trim().slice(0, 2000), en: a.en.trim().slice(0, 2000) };
  } else throw new AppError("validation");
  return { name, active: input.active, trigger: input.trigger, triggerStatus, category: input.category?.trim() || null, action };
}

const adminOnly = (actor: User) => {
  if (actor.role !== "admin") throw new AppError("forbidden");
};

export async function listRules(db: DbOrTx) {
  return db.select().from(automationRules).orderBy(desc(automationRules.createdAt));
}

export async function createRule(db: DbOrTx, actor: User, input: RuleInput) {
  adminOnly(actor);
  const [r] = await db.insert(automationRules).values({ ...clean(input), createdById: actor.id }).returning();
  await audit(db, { actorId: actor.id, action: "automation.create", entityType: "settings", details: { id: r!.id, name: r!.name } });
  return r!;
}

export async function updateRule(db: DbOrTx, actor: User, id: string, input: RuleInput) {
  adminOnly(actor);
  const [r] = await db.update(automationRules).set(clean(input)).where(eq(automationRules.id, id)).returning();
  if (!r) throw new AppError("not_found");
  await audit(db, { actorId: actor.id, action: "automation.update", entityType: "settings", details: { id, name: r.name, active: r.active } });
  return r;
}

export async function deleteRule(db: DbOrTx, actor: User, id: string) {
  adminOnly(actor);
  const rows = await db.delete(automationRules).where(eq(automationRules.id, id)).returning({ id: automationRules.id });
  if (rows.length === 0) throw new AppError("not_found");
  await audit(db, { actorId: actor.id, action: "automation.delete", entityType: "settings", details: { id } });
}
