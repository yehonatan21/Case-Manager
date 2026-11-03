import { and, asc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { aiRuns, cases, serviceTemplates, tasks, users, type Task, type TaskStatus, type User } from "../db/schema";
import { AppError } from "../errors";
import { adminCaseLink, caseWithAccess, staffCaseScope } from "./cases";
import { addEvent } from "./events";
import { notify } from "./notifications";
import { addDaysIso, todayIso } from "../utils";

export type TaskInput = {
  title: string;
  description?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  priority?: "low" | "normal" | "high";
  requiresClientAction?: boolean;
  status?: TaskStatus;
};

async function insertTasks(tx: DbOrTx, actor: User, c: { id: string; number: string }, items: TaskInput[], aiRunId?: string | null) {
  const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), 0)::int` }).from(tasks).where(eq(tasks.caseId, c.id));
  const rows = await tx
    .insert(tasks)
    .values(
      items.map((t, i) => ({
        caseId: c.id,
        title: t.title.trim().slice(0, 300),
        description: t.description?.trim() ?? "",
        assigneeId: t.assigneeId ?? null,
        dueDate: t.dueDate || null,
        priority: t.priority ?? "normal",
        requiresClientAction: !!t.requiresClientAction,
        status: t.status ?? "todo",
        sortOrder: max + i + 1,
        createdById: actor.id,
        aiRunId: aiRunId ?? null,
      })),
    )
    .returning();
  for (const t of rows) {
    if (t.assigneeId && t.assigneeId !== actor.id) {
      await notify(tx, { userIds: [t.assigneeId], type: "task_assigned", caseId: c.id, vars: { title: t.title, number: c.number }, link: `${adminCaseLink(c.id)}?tab=tasks` });
    }
  }
  return rows;
}

export async function createTasks(db: Database, actor: User, caseId: string, items: TaskInput[], opts: { aiRunId?: string | null } = {}) {
  if (items.length === 0) return [];
  return db.transaction(async (tx) => {
    const { c, access } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit) throw new AppError("forbidden");
    const rows = await insertTasks(tx, actor, c, items, opts.aiRunId);
    if (rows.length > 1) await addEvent(tx, { caseId: c.id, type: "tasks_created", actor, visibility: "internal", data: { count: rows.length } });
    if (opts.aiRunId) await tx.update(aiRuns).set({ approvedById: actor.id, approvedAt: new Date() }).where(eq(aiRuns.id, opts.aiRunId));
    return rows;
  });
}

export async function applyTemplate(db: Database, actor: User, caseId: string, templateId: string) {
  const [tpl] = await db.select().from(serviceTemplates).where(eq(serviceTemplates.id, templateId));
  if (!tpl) throw new AppError("not_found");
  const { c } = await caseWithAccess(db, actor, caseId);
  return createTasks(
    db,
    actor,
    caseId,
    tpl.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      dueDate: t.dueInDays != null ? addDaysIso(t.dueInDays) : null,
      priority: t.priority ?? "normal",
      requiresClientAction: t.requiresClientAction,
      assigneeId: c.assigneeId,
    })),
  );
}

export async function updateTask(db: Database, actor: User, taskId: string, patch: Partial<TaskInput>) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!t) throw new AppError("not_found");
    const { c, access } = await caseWithAccess(tx, actor, t.caseId);
    if (!access.edit) throw new AppError("forbidden");
    const set: Partial<Task> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title.trim();
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate || null;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.requiresClientAction !== undefined) set.requiresClientAction = patch.requiresClientAction;
    if (patch.status !== undefined) {
      set.status = patch.status;
      set.completedAt = patch.status === "done" ? new Date() : null;
    }
    const [updated] = await tx.update(tasks).set(set).where(eq(tasks.id, t.id)).returning();
    if (patch.status === "done" && t.status !== "done") {
      await addEvent(tx, { caseId: c.id, type: "task_completed", actor, visibility: t.requiresClientAction ? "client" : "internal", data: { title: t.title } });
    }
    if (patch.assigneeId && patch.assigneeId !== t.assigneeId && patch.assigneeId !== actor.id) {
      await notify(tx, { userIds: [patch.assigneeId], type: "task_assigned", caseId: c.id, vars: { title: updated!.title, number: c.number }, link: `${adminCaseLink(c.id)}?tab=tasks` });
    }
    return updated!;
  });
}

export async function deleteTask(db: Database, actor: User, taskId: string) {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t) throw new AppError("not_found");
  const { access } = await caseWithAccess(db, actor, t.caseId);
  if (!access.edit) throw new AppError("forbidden");
  await db.delete(tasks).where(eq(tasks.id, t.id));
}

export async function listTasksForStaff(db: DbOrTx, actor: User, filter: { mine?: boolean; overdue?: boolean; open?: boolean }) {
  const conds: (SQL | undefined)[] = [staffCaseScope(actor)];
  if (filter.mine) conds.push(eq(tasks.assigneeId, actor.id));
  if (filter.open !== false) conds.push(inArray(tasks.status, ["todo", "in_progress", "waiting"]));
  if (filter.overdue) conds.push(lt(tasks.dueDate, todayIso()));
  return db
    .select({
      task: tasks,
      caseNumber: cases.number,
      caseTitle: cases.title,
      assigneeName: users.name,
    })
    .from(tasks)
    .innerJoin(cases, eq(cases.id, tasks.caseId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(...conds.filter(Boolean)))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
    .limit(300);
}
