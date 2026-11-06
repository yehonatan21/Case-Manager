import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assignCase, changeStatus, getCaseBundle } from "@/lib/services/cases";
import { upsertTemplate } from "@/lib/services/catalog";
import { applyTemplate, setMilestoneDone, updateTask } from "@/lib/services/tasks";
import { reviewDocument } from "@/lib/services/documents";
import { createRule, deleteRule, listRules, updateRule } from "@/lib/services/automation";
import { sendQuoteFollowups } from "@/lib/services/quotes";
import { updateSettings } from "@/lib/services/settings";
import { postMessage } from "@/lib/services/messages";
import { conversationCounts, createReplyTemplate, deleteReplyTemplate, fillReply, listConversations } from "@/lib/services/conversations";
import { formatWorkPlan, parseWorkPlan } from "@/lib/work-plan";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let manager: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
});

/** In-app notifications (each one may also have an email, push or WhatsApp copy). */
const notes = (userId: string, type: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, type), eq(s.notifications.channel, "in_app")));

describe("work plan text", () => {
  it("reads stages, client actions and 'waits for the task above', and writes them back", () => {
    const text = ["Open the file", "## Collect documents | 7", "* Upload passport | 3", "> Check the documents", "## Internal review (team) | 10", "> Review the application"].join("\n");
    const plan = parseWorkPlan(text);
    expect(plan.stages).toEqual([{ title: "Collect documents", dueInDays: 7 }, { title: "Internal review", dueInDays: 10, clientVisible: false }]);
    expect(plan.tasks).toEqual([
      { title: "Open the file", requiresClientAction: false },
      { title: "Upload passport", requiresClientAction: true, dueInDays: 3, stage: 0 },
      { title: "Check the documents", requiresClientAction: false, stage: 0, after: 1 },
      { title: "Review the application", requiresClientAction: false, stage: 1, after: 2 },
    ]);
    expect(parseWorkPlan(formatWorkPlan(plan.stages, plan.tasks))).toEqual(plan);
    // The old one-line-per-task format still reads the same.
    expect(parseWorkPlan("Call the client | 2\nUpload ID *").tasks).toEqual([
      { title: "Call the client", requiresClientAction: false, dueInDays: 2 },
      { title: "Upload ID", requiresClientAction: true },
    ]);
  });
});

describe("work plans on a case", () => {
  it("creates the stages as milestones, holds tasks until the one before is done, and completes stages", async () => {
    const staff = await makeUser(db, "staff");
    const tpl = await upsertTemplate(db, admin, {
      name: "Visa plan",
      category: "immigration_visa",
      ...parseWorkPlan(["## Documents | 5", "Ask for documents", "> Check documents | 4", "## Filing (team) | 12", "> File the application"].join("\n")),
    });
    expect(tpl.stages).toHaveLength(2);
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    await assignCase(db, admin, c.id, staff.id);
    const rows = await applyTemplate(db, admin, c.id, tpl.id);
    expect(rows.map((r) => r.status)).toEqual(["todo", "waiting", "waiting"]);
    const ms = await db.select().from(s.caseMilestones).where(eq(s.caseMilestones.caseId, c.id)).orderBy(s.caseMilestones.sortOrder);
    expect(ms.map((m) => [m.title, m.clientVisible])).toEqual([["Documents", true], ["Filing", false]]);
    const [caseRow] = await db.select().from(s.cases).where(eq(s.cases.id, c.id));
    expect(caseRow!.dueDate).toBe(ms[1]!.dueDate);
    // Waiting tasks don't notify their handler yet.
    expect((await notes(staff.id, "task_assigned")).length).toBe(1);

    await updateTask(db, admin, rows[0]!.id, { status: "done" });
    const [second] = await db.select().from(s.tasks).where(eq(s.tasks.id, rows[1]!.id));
    expect(second!.status).toBe("todo");
    expect((await notes(staff.id, "task_unblocked")).length).toBe(1);
    await updateTask(db, admin, rows[1]!.id, { status: "done" });
    const [m1] = await db.select().from(s.caseMilestones).where(eq(s.caseMilestones.id, ms[0]!.id));
    expect(m1!.completedAt).not.toBeNull();
    // Reopening a task reopens its stage.
    await updateTask(db, admin, rows[1]!.id, { status: "todo" });
    expect((await db.select().from(s.caseMilestones).where(eq(s.caseMilestones.id, ms[0]!.id)))[0]!.completedAt).toBeNull();

    // The client sees only their stages, and the completed-stage event.
    await setMilestoneDone(db, admin, ms[0]!.id, true);
    const view = await getCaseBundle(db, client, c.id);
    expect(view.milestones.map((m) => m.title)).toEqual(["Documents"]);
    expect(view.events.some((e) => e.type === "milestone_completed")).toBe(true);
    await expectCode(setMilestoneDone(db, client, ms[0]!.id, false), "forbidden");
  });
});

describe("automation rules", () => {
  it("only admins manage them", async () => {
    await expectCode(createRule(db, manager, { name: "x", active: true, trigger: "quote_approved", action: { type: "notify_owner", text: "x" } }), "forbidden");
    await expectCode(createRule(db, admin, { name: "x", active: true, trigger: "quote_approved", action: { type: "create_task", title: " " } }), "validation");
  });

  it("all required documents approved → a task for the handler, only for the rule's service type", async () => {
    const rule = await createRule(db, admin, { name: "Docs in → prepare", active: true, trigger: "documents_complete", category: "immigration_visa", action: { type: "create_task", title: "Prepare the application for {client}", dueInDays: 2 } });
    const make = async (category: string) => {
      const client = await makeUser(db, "customer");
      const c = await makeCase(db, client);
      await db.update(s.cases).set({ serviceCategory: category, status: "active", assigneeId: manager.id }).where(eq(s.cases.id, c.id));
      const docs = await db.insert(s.documents).values([{ caseId: c.id, title: "Passport", status: "uploaded" }, { caseId: c.id, title: "Photo", status: "uploaded" }]).returning();
      return { c, client, docs };
    };
    const visa = await make("immigration_visa");
    await reviewDocument(db, admin, visa.docs[0]!.id, { status: "approved" });
    expect(await db.select().from(s.tasks).where(eq(s.tasks.caseId, visa.c.id))).toHaveLength(0);
    await reviewDocument(db, admin, visa.docs[1]!.id, { status: "approved" });
    const created = await db.select().from(s.tasks).where(eq(s.tasks.caseId, visa.c.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: `Prepare the application for ${visa.client.name}`, assigneeId: manager.id });
    const events = await db.select().from(s.caseEvents).where(eq(s.caseEvents.caseId, visa.c.id));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["documents_complete", "rule_applied"]));
    expect((await listRules(db)).find((r) => r.id === rule.id)!.runCount).toBe(1);

    const other = await make("business_consulting");
    for (const doc of other.docs) await reviewDocument(db, admin, doc.id, { status: "approved" });
    expect(await db.select().from(s.tasks).where(eq(s.tasks.caseId, other.c.id))).toHaveLength(0);
    await deleteRule(db, admin, rule.id);
  });

  it("a status reached → an automatic message to the client in their language; inactive rules don't run", async () => {
    const rule = await createRule(db, admin, { name: "Done → thanks", active: true, trigger: "status_changed", triggerStatus: "completed", action: { type: "message_client", he: "תודה {client}!", en: "Thank you, {client}! Case {number} is complete." } });
    const client = await makeUser(db, "customer", { locale: "en" });
    const c = await makeCase(db, client);
    await db.update(s.cases).set({ status: "active" }).where(eq(s.cases.id, c.id));
    await changeStatus(db, admin, c.id, "completed");
    const msgs = await db.select().from(s.messages).where(eq(s.messages.caseId, c.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ via: "automation", senderId: null, body: `Thank you, ${client.name}! Case ${c.number} is complete.` });
    expect((await getCaseBundle(db, client, c.id)).messages).toHaveLength(1);

    await updateRule(db, admin, rule.id, { name: rule.name, active: false, trigger: rule.trigger, triggerStatus: "completed", action: rule.action });
    const c2 = await makeCase(db, client);
    await db.update(s.cases).set({ status: "active" }).where(eq(s.cases.id, c2.id));
    await changeStatus(db, admin, c2.id, "completed");
    expect(await db.select().from(s.messages).where(eq(s.messages.caseId, c2.id))).toHaveLength(0);
  });
});

describe("quote follow-up", () => {
  it("reminds the client after N days and the handler after M days, once each", async () => {
    await updateSettings(db, admin, { quote_followup_client_days: 3, quote_followup_staff_days: 5 });
    const client = await makeUser(db, "customer");
    const { c, quoteId } = await caseWithSentQuote(db, client, manager);
    expect(await sendQuoteFollowups(db)).toMatchObject({ client: 0, staff: 0 });
    await db.update(s.quotes).set({ sentAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) }).where(eq(s.quotes.id, quoteId));
    expect((await sendQuoteFollowups(db)).client).toBeGreaterThanOrEqual(1);
    expect((await notes(client.id, "quote_followup_client")).filter((n) => n.caseId === c.id)).toHaveLength(1);
    expect((await notes(manager.id, "quote_followup_staff")).filter((n) => n.caseId === c.id)).toHaveLength(0);
    await db.update(s.quotes).set({ sentAt: new Date(Date.now() - 6 * 24 * 3600 * 1000) }).where(eq(s.quotes.id, quoteId));
    await sendQuoteFollowups(db);
    await sendQuoteFollowups(db);
    expect((await notes(client.id, "quote_followup_client")).filter((n) => n.caseId === c.id)).toHaveLength(1);
    expect((await notes(manager.id, "quote_followup_staff")).filter((n) => n.caseId === c.id)).toHaveLength(1);
    // 0 turns them off.
    await updateSettings(db, admin, { quote_followup_client_days: 0, quote_followup_staff_days: 0 });
    const other = await caseWithSentQuote(db, client, manager);
    await db.update(s.quotes).set({ sentAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) }).where(eq(s.quotes.id, other.quoteId));
    expect(await sendQuoteFollowups(db)).toEqual({ client: 0, staff: 0 });
  });
});

describe("conversations", () => {
  it("lists client messages waiting for an answer until the team replies, within each user's cases", async () => {
    const staff = await makeUser(db, "staff");
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client, "Conversation case");
    await assignCase(db, admin, c.id, staff.id);
    await postMessage(db, client, c.id, { body: "Is there any news?", kind: "thread" });
    const waiting = await listConversations(db, staff, { filter: "needs_reply" });
    expect(waiting.rows.find((r) => r.caseId === c.id)).toMatchObject({ fromClient: true, unread: true, lastBody: "Is there any news?", customerName: client.name });
    expect((await conversationCounts(db, staff)).needs_reply).toBeGreaterThanOrEqual(1);
    // Another staff member doesn't see this case.
    const other = await makeUser(db, "staff");
    expect((await listConversations(db, other, { filter: "all" })).rows.some((r) => r.caseId === c.id)).toBe(false);
    await postMessage(db, staff, c.id, { body: "Yes, we filed it today.", kind: "thread" });
    expect((await listConversations(db, staff, { filter: "needs_reply" })).rows.some((r) => r.caseId === c.id)).toBe(false);
    expect((await listConversations(db, staff, { filter: "mine", q: "filed it" })).rows.map((r) => r.caseId)).toEqual([c.id]);
  });

  it("saved replies are managed by admins and case managers and filled in the client's language", async () => {
    await expectCode(createReplyTemplate(db, await makeUser(db, "staff"), { title: "x", bodyHe: "x", bodyEn: "" }), "forbidden");
    const t = await createReplyTemplate(db, manager, { title: "Received", bodyHe: "שלום {client}, קיבלנו את המסמכים בתיק {number}.", bodyEn: "Hi {client}, we received the documents for case {number}." });
    expect(fillReply(t, "en", { client: "Dana", number: "CM-1" })).toBe("Hi Dana, we received the documents for case CM-1.");
    expect(fillReply(t, "he", { client: "דנה", number: "CM-1" })).toBe("שלום דנה, קיבלנו את המסמכים בתיק CM-1.");
    expect(fillReply({ bodyHe: "", bodyEn: "Only English" }, "he", { client: "", number: "" })).toBe("Only English");
    await deleteReplyTemplate(db, admin, t.id);
  });
});
