import { and, asc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { aiRuns, caseMilestones, cases, priorityEnum, serviceTemplates, tasks, taskStatusEnum, users, type Case, type Task, type TaskStatus, type User } from "../db/schema";
import { AppError } from "../errors";
import { adminCaseLink, caseWithAccess, staffCaseScope } from "./cases";
import { addEvent } from "./events";
import { notify } from "./notifications";
import { addDaysIso, todayIso } from "../utils";
import { zonedDay } from "../meetings";
import { likeTerm } from "./customers";
import { isDay, isUuid, LIST_PAGE_SIZE, oneOf, paged, pageNumber, searchTerm } from "./list-filters";

export type TaskInput = {
  title: string;
  description?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  priority?: "low" | "normal" | "high";
  requiresClientAction?: boolean;
  status?: TaskStatus;
  milestoneId?: string | null;
  /** Waits for another task; its handler is told when it unlocks, not now. */
  blocked?: boolean;
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
        milestoneId: t.milestoneId ?? null,
        createdById: actor.id,
        aiRunId: aiRunId ?? null,
      })),
    )
    .returning();
  for (const [i, t] of rows.entries()) {
    if (t.assigneeId && t.assigneeId !== actor.id && !items[i]!.blocked) {
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

/**
 * Applies a service template's work plan to a case: a milestone per stage (with its target date), the tasks
 * (in their stages, each waiting for the one it follows), and the case deadline if it has none.
 */
export async function applyTemplate(db: Database, actor: User, caseId: string, templateId: string) {
  const [tpl] = await db.select().from(serviceTemplates).where(eq(serviceTemplates.id, templateId));
  if (!tpl) throw new AppError("not_found");
  return db.transaction(async (tx) => {
    const { c, access } = await caseWithAccess(tx, actor, caseId);
    if (!access.edit) throw new AppError("forbidden");
    const [{ max } = { max: 0 }] = await tx.select({ max: sql<number>`coalesce(max(${caseMilestones.sortOrder}), 0)::int` }).from(caseMilestones).where(eq(caseMilestones.caseId, c.id));
    const stages = tpl.stages ?? [];
    const milestones = stages.length
      ? await tx
          .insert(caseMilestones)
          .values(stages.map((s, i) => ({ caseId: c.id, title: s.title.slice(0, 200), dueDate: s.dueInDays != null ? addDaysIso(s.dueInDays) : null, clientVisible: s.clientVisible ?? true, sortOrder: max + i + 1 })))
          .returning()
      : [];
    // A task may only wait for one listed before it (no loops).
    const waitsFor = (i: number) => {
      const a = tpl.tasks[i]!.after;
      return a != null && a >= 0 && a < i ? a : null;
    };
    const rows = tpl.tasks.length
      ? await insertTasks(
          tx,
          actor,
          c,
          tpl.tasks.map((t, i) => ({
            title: t.title,
            description: t.description,
            dueDate: t.dueInDays != null ? addDaysIso(t.dueInDays) : null,
            priority: t.priority ?? "normal",
            requiresClientAction: t.requiresClientAction,
            assigneeId: t.requiresClientAction ? null : c.assigneeId,
            milestoneId: t.stage != null ? (milestones[t.stage]?.id ?? null) : null,
            status: waitsFor(i) != null ? ("waiting" as const) : ("todo" as const),
            blocked: waitsFor(i) != null,
          })),
        )
      : [];
    for (const [i, row] of rows.entries()) {
      const a = waitsFor(i);
      if (a != null) await tx.update(tasks).set({ dependsOnId: rows[a]!.id }).where(eq(tasks.id, row.id));
    }
    const lastStage = milestones.map((m) => m.dueDate).filter(Boolean).sort().at(-1);
    if (lastStage && !c.dueDate) await tx.update(cases).set({ dueDate: lastStage, dueRemindedOn: null }).where(eq(cases.id, c.id));
    if (milestones.length) await addEvent(tx, { caseId: c.id, type: "work_plan_applied", actor, visibility: "client", data: { count: milestones.length } });
    else if (rows.length > 1) await addEvent(tx, { caseId: c.id, type: "tasks_created", actor, visibility: "internal", data: { count: rows.length } });
    return rows;
  });
}

/**
 * After a task's status changes: unlocks the tasks that waited for it (telling their handlers), and completes
 * or reopens its milestone. Returns the milestone completed now, if any (for automation rules).
 */
async function afterTaskStatus(tx: DbOrTx, actor: User, c: Case, t: Task, status: TaskStatus) {
  if (status === "done" || status === "cancelled") {
    const waiting = await tx.select().from(tasks).where(and(eq(tasks.dependsOnId, t.id), eq(tasks.status, "waiting")));
    for (const w of waiting) {
      await tx.update(tasks).set({ status: "todo", updatedAt: new Date() }).where(eq(tasks.id, w.id));
      if (w.assigneeId && w.assigneeId !== actor.id) {
        await notify(tx, { userIds: [w.assigneeId], type: "task_unblocked", caseId: c.id, vars: { title: w.title, number: c.number, after: t.title }, link: `${adminCaseLink(c.id)}?tab=tasks` });
      }
    }
  }
  if (!t.milestoneId) return null;
  const [m] = await tx.select().from(caseMilestones).where(eq(caseMilestones.id, t.milestoneId));
  if (!m) return null;
  const [{ open } = { open: 0 }] = await tx
    .select({ open: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.milestoneId, m.id), inArray(tasks.status, ["todo", "in_progress", "waiting"])));
  if (open === 0 && !m.completedAt) {
    await tx.update(caseMilestones).set({ completedAt: new Date() }).where(eq(caseMilestones.id, m.id));
    await addEvent(tx, { caseId: c.id, type: "milestone_completed", actor, visibility: m.clientVisible ? "client" : "internal", data: { title: m.title } });
    return m;
  }
  if (open > 0 && m.completedAt) await tx.update(caseMilestones).set({ completedAt: null }).where(eq(caseMilestones.id, m.id));
  return null;
}

/** Marks a milestone done (or not) by hand. */
export async function setMilestoneDone(db: Database, actor: User, milestoneId: string, done: boolean) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(caseMilestones).where(eq(caseMilestones.id, milestoneId));
    if (!m) throw new AppError("not_found");
    const { c, access } = await caseWithAccess(tx, actor, m.caseId);
    if (!access.edit) throw new AppError("forbidden");
    if (done === !!m.completedAt) return m;
    const [u] = await tx.update(caseMilestones).set({ completedAt: done ? new Date() : null }).where(eq(caseMilestones.id, m.id)).returning();
    if (done) {
      await addEvent(tx, { caseId: c.id, type: "milestone_completed", actor, visibility: m.clientVisible ? "client" : "internal", data: { title: m.title } });
    }
    return u!;
  });
}

export async function deleteMilestone(db: Database, actor: User, milestoneId: string) {
  const [m] = await db.select().from(caseMilestones).where(eq(caseMilestones.id, milestoneId));
  if (!m) throw new AppError("not_found");
  const { access } = await caseWithAccess(db, actor, m.caseId);
  if (!access.edit) throw new AppError("forbidden");
  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ milestoneId: null }).where(eq(tasks.milestoneId, m.id));
    await tx.delete(caseMilestones).where(eq(caseMilestones.id, m.id));
  });
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
    if (patch.status !== undefined && patch.status !== t.status) {
      // A milestone completed here starts its automation rules through its history event.
      await afterTaskStatus(tx, actor, c, t, patch.status);
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

export const TASK_STATUS_FILTERS = ["open", ...taskStatusEnum.enumValues, "all"] as const;
export const TASK_PRIORITIES = priorityEnum.enumValues;
export type TaskListFilter = {
  mine?: boolean;
  overdue?: boolean;
  /** Only open tasks (the default); false for every status. Overridden by `status`. */
  open?: boolean;
  q?: string;
  /** A team member's id, or "none" for tasks no one has. */
  assignee?: string;
  priority?: string;
  /** "open" (to do, in progress, waiting), one status, or "all". */
  status?: string;
  /** Due between these days (both included). */
  from?: string;
  to?: string;
  page?: number;
};

const OPEN_TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "waiting"];

/**
 * Tasks on the cases the user may see, the nearest due first, a page at a time: mine or everyone's, overdue, and
 * searched by title or case, by assignee, priority, status and due date. "Overdue" uses the office's today.
 */
export async function listTasksForStaff(db: DbOrTx, actor: User, f: TaskListFilter = {}) {
  const conds: (SQL | undefined)[] = [staffCaseScope(actor)];
  if (f.mine) conds.push(eq(tasks.assigneeId, actor.id));
  const status = oneOf(f.status, TASK_STATUS_FILTERS) ?? (f.open === false ? "all" : "open");
  if (status === "open" || f.overdue) conds.push(inArray(tasks.status, OPEN_TASK_STATUSES));
  else if (status !== "all") conds.push(eq(tasks.status, status));
  if (f.overdue) conds.push(lt(tasks.dueDate, zonedDay(new Date()).day));
  const q = searchTerm(f.q);
  if (q) {
    const like = likeTerm(q);
    conds.push(or(ilike(tasks.title, like), ilike(cases.number, like), ilike(cases.title, like)));
  }
  if (!f.mine && f.assignee === "none") conds.push(isNull(tasks.assigneeId));
  else if (!f.mine && isUuid(f.assignee)) conds.push(eq(tasks.assigneeId, f.assignee));
  const priority = oneOf(f.priority, TASK_PRIORITIES);
  if (priority) conds.push(eq(tasks.priority, priority));
  if (isDay(f.from)) conds.push(gte(tasks.dueDate, f.from));
  if (isDay(f.to)) conds.push(lte(tasks.dueDate, f.to));
  const where = and(...conds.filter(Boolean));
  const page = pageNumber(f.page);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        task: tasks,
        caseNumber: cases.number,
        caseTitle: cases.title,
        assigneeName: users.name,
      })
      .from(tasks)
      .innerJoin(cases, eq(cases.id, tasks.caseId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(where)
      .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt), asc(tasks.id))
      .limit(LIST_PAGE_SIZE)
      .offset((page - 1) * LIST_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(tasks).innerJoin(cases, eq(cases.id, tasks.caseId)).where(where),
  ]);
  return paged(rows, count?.n ?? 0, page);
}
