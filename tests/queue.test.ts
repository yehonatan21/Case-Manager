import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assignCase, getCaseBundle, updateCaseFields } from "@/lib/services/cases";
import { bulkUpdateCases, cleanViewQuery, deleteSavedView, listQueue, listSavedViews, officeToday, queueCounts, saveView, sendDeadlineReminders, teamWorkload } from "@/lib/services/queue";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let manager: s.User;
let staff: s.User;

const day = (n: number) => {
  const d = new Date(`${officeToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
  staff = await makeUser(db, "staff");
});

async function openCase(title: string, set: Partial<s.Case> = {}) {
  const c = await makeCase(db, await makeUser(db, "customer"), title);
  await db.update(s.cases).set({ status: "active", ...set }).where(eq(s.cases.id, c.id));
  return c;
}

describe("deadlines and waiting on others", () => {
  it("are team-only fields with their own history", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    await assignCase(db, admin, c.id, manager.id);
    await expectCode(updateCaseFields(db, manager, c.id, { dueDate: "20/11/2026" }), "validation");
    await updateCaseFields(db, manager, c.id, { dueDate: day(10), waiting: { thirdParty: true, note: "Population Authority" } });
    const [row] = await db.select().from(s.cases).where(eq(s.cases.id, c.id));
    expect(row).toMatchObject({ dueDate: day(10), waitingOnThirdParty: true, waitingNote: "Population Authority" });
    const events = await db.select().from(s.caseEvents).where(eq(s.caseEvents.caseId, c.id));
    expect(events.filter((e) => ["due_date_set", "waiting_third_party"].includes(e.type)).map((e) => e.visibility)).toEqual(["internal", "internal"]);
    const clientView = await getCaseBundle(db, client, c.id);
    expect(JSON.stringify(clientView.events)).not.toContain("Population Authority");
    // Clearing the flag drops the note.
    await updateCaseFields(db, manager, c.id, { waiting: { thirdParty: false, note: "ignored" } });
    expect((await db.select().from(s.cases).where(eq(s.cases.id, c.id)))[0]).toMatchObject({ waitingOnThirdParty: false, waitingNote: null });
  });
});

describe("work queue", () => {
  it("puts each case in the right views, late ones first, then by urgency and deadline", async () => {
    const tag = `Q${Date.now()}`;
    const late = await openCase(`${tag} late`, { assigneeId: manager.id, dueDate: day(-2), urgency: "low" });
    const urgent = await openCase(`${tag} urgent`, { assigneeId: manager.id, urgency: "urgent", dueDate: day(20) });
    const soon = await openCase(`${tag} soon`, { assigneeId: manager.id, dueDate: day(3) });
    const waiting = await openCase(`${tag} waiting`, { assigneeId: manager.id, waitingOnThirdParty: true, waitingNote: "Court" });
    const client = await openCase(`${tag} client`, { assigneeId: manager.id, status: "awaiting_client" });
    const stale = await openCase(`${tag} stale`, { assigneeId: manager.id, createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000), lastClientActivityAt: new Date(Date.now() - 20 * 24 * 3600 * 1000), lastStaffActivityAt: null });
    const nobody = await openCase(`${tag} nobody`);
    const taskLate = await openCase(`${tag} tasklate`, { assigneeId: manager.id });
    await db.insert(s.tasks).values({ caseId: taskLate.id, title: "Call the bank", dueDate: day(-1) });
    await openCase(`${tag} done`, { assigneeId: manager.id, status: "completed", dueDate: day(-5) });

    const ids = async (view: string) => (await listQueue(db, manager, { view, q: tag })).rows.map((r) => r.id);
    const mine = await ids("mine");
    // Late cases first (whatever their urgency), then the urgent one; completed cases never show.
    expect(new Set(mine.slice(0, 2))).toEqual(new Set([late.id, taskLate.id]));
    expect(mine[2]).toBe(urgent.id);
    expect(mine).not.toContain(nobody.id);
    expect(mine).toHaveLength(7);
    expect(await ids("overdue")).toEqual(expect.arrayContaining([late.id, taskLate.id]));
    expect(await ids("overdue")).toHaveLength(2);
    expect(await ids("due_soon")).toEqual([soon.id]);
    expect(await ids("waiting_third_party")).toEqual([waiting.id]);
    expect(await ids("waiting_client")).toEqual([client.id]);
    expect(await ids("stale")).toContain(stale.id);
    expect(await ids("unassigned")).toEqual([nobody.id]);
    const row = (await listQueue(db, manager, { view: "mine", q: `${tag} tasklate` })).rows[0]!;
    expect(row).toMatchObject({ overdueTasks: 1, late: true });

    // Staff see only their own cases; the counts match the lists.
    expect((await listQueue(db, staff, { view: "all", q: tag })).rows).toHaveLength(0);
    const counts = await queueCounts(db, manager);
    expect(counts.overdue).toBeGreaterThanOrEqual(2);
    expect(counts.all).toBeGreaterThanOrEqual(counts.mine);
  });

  it("shows each member's workload to managers only", async () => {
    await expectCode(teamWorkload(db, staff), "forbidden");
    const w = await teamWorkload(db, manager);
    const me = w.members.find((m) => m.id === manager.id)!;
    expect(me.cases.open).toBeGreaterThanOrEqual(7);
    expect(me.cases.overdue).toBeGreaterThanOrEqual(1);
    expect(w.unassigned.open).toBeGreaterThanOrEqual(1);
    expect(w.members.some((m) => m.role === "finance")).toBe(false);
  });
});

describe("bulk changes", () => {
  it("apply each case's own checks and list the ones that couldn't change", async () => {
    const a = await openCase("bulk a", { assigneeId: manager.id });
    const b = await openCase("bulk b", { assigneeId: manager.id, status: "under_review" });
    await expectCode(bulkUpdateCases(db, staff, [a.id], { type: "urgency", urgency: "high" }), "forbidden");
    let r = await bulkUpdateCases(db, manager, [a.id, b.id], { type: "assign", assigneeId: staff.id });
    expect(r).toEqual({ done: [a.id, b.id], failed: [] });
    r = await bulkUpdateCases(db, admin, [a.id, b.id], { type: "due_date", dueDate: day(5) });
    expect(r.done).toHaveLength(2);
    // Active → awaiting client works; under review → active needs a reason, given on the case page.
    r = await bulkUpdateCases(db, admin, [a.id, b.id], { type: "status", status: "active" });
    expect(r.done).toEqual([a.id]);
    expect(r.failed).toEqual([{ id: b.id, number: b.number, code: "activation_reason_required" }]);
    const rows = await db.select().from(s.cases).where(eq(s.cases.assigneeId, staff.id));
    expect(rows.filter((x) => [a.id, b.id].includes(x.id)).every((x) => x.dueDate === day(5))).toBe(true);
  });
});

describe("saved views", () => {
  it("belong to their owner and keep only the queue's filters", async () => {
    expect(cleanViewQuery("?view=overdue&q=visa&page=3&evil=1")).toBe("view=overdue&q=visa");
    const v = await saveView(db, manager, { name: "Late visas", query: "view=overdue&q=visa" });
    await saveView(db, manager, { name: "Late visas", query: "view=overdue&q=passport" });
    const mine = await listSavedViews(db, manager);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.query).toBe("view=overdue&q=passport");
    expect(await listSavedViews(db, staff)).toEqual([]);
    await expectCode(deleteSavedView(db, staff, v.id), "not_found");
    await deleteSavedView(db, manager, v.id);
    expect(await listSavedViews(db, manager)).toEqual([]);
  });
});

describe("deadline reminders", () => {
  it("remind the handler the day before and on the day, once a day", async () => {
    const c = await openCase("due tomorrow", { assigneeId: staff.id, dueDate: day(1) });
    const nobody = await openCase("due today, unassigned", { dueDate: day(0) });
    expect(await sendDeadlineReminders(db)).toBeGreaterThanOrEqual(2);
    expect(await sendDeadlineReminders(db)).toBe(0);
    const n = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, staff.id), eq(s.notifications.type, "case_due_tomorrow"), eq(s.notifications.caseId, c.id)));
    expect(n.length).toBeGreaterThan(0);
    const toAdmin = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, admin.id), eq(s.notifications.type, "case_due_today"), eq(s.notifications.caseId, nobody.id)));
    expect(toAdmin.length).toBeGreaterThan(0);
    // A new deadline is reminded again.
    await updateCaseFields(db, admin, c.id, { dueDate: day(0) });
    expect(await sendDeadlineReminders(db)).toBe(1);
  });
});
