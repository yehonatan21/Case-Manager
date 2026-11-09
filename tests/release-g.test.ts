import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assignCase } from "@/lib/services/cases";
import { listQuotesForStaff } from "@/lib/services/quotes";
import { listPayments, paymentProviders } from "@/lib/services/payments";
import { listTasksForStaff } from "@/lib/services/tasks";
import { navCounts } from "@/lib/services/nav-counts";
import { officeToday } from "@/lib/services/queue";
import { dayRange, oneOf, toCents } from "@/lib/services/list-filters";
import { addDays } from "@/lib/calendar-view";
import { caseWithSentQuote, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let member: s.User;
let other: s.User;
let c: s.Case;
let quoteId: string;
const today = officeToday();

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  member = await makeUser(db, "staff");
  other = await makeUser(db, "staff");
  const customer = await makeUser(db, "customer");
  ({ c, quoteId } = await caseWithSentQuote(db, customer));
  await assignCase(db, admin, c.id, member.id);
  await db.insert(s.payments).values([
    { caseId: c.id, quoteId, provider: "mock", amountCents: 100_00, currency: "ILS", status: "succeeded", paidAt: new Date() },
    { caseId: c.id, quoteId, provider: "mock", amountCents: 50_00, currency: "ILS", status: "pending" },
  ]);
  await db.insert(s.tasks).values([
    { caseId: c.id, title: "Call the bank", assigneeId: member.id, dueDate: addDays(today, -1), priority: "high" },
    { caseId: c.id, title: "File the form", dueDate: addDays(today, 5), priority: "low" },
    { caseId: c.id, title: "Old step", assigneeId: member.id, status: "done", dueDate: addDays(today, -10) },
  ]);
  // The client wrote last: the conversation waits for an answer.
  await db.insert(s.messages).values({ caseId: c.id, senderId: customer.id, body: "Any news?" });
});

describe("list filter helpers", () => {
  it("ignores values that aren't allowed and reads amounts in whole units", () => {
    expect(oneOf("sent", ["draft", "sent"])).toBe("sent");
    expect(oneOf("drop table", ["draft", "sent"])).toBeUndefined();
    expect(toCents("149.90")).toBe(14990);
    expect(toCents("1,500")).toBe(150000);
    expect(toCents("abc")).toBeUndefined();
    expect(toCents("-5")).toBeUndefined();
    expect(dayRange(s.quotes.updatedAt, "2026-13-45", "nope")).toHaveLength(0);
    expect(dayRange(s.quotes.updatedAt, "2026-01-01", "2026-01-31")).toHaveLength(2);
  });
});

describe("Quotes: search, filters, paging", () => {
  it("finds by case number or client, filters by status and day, only on cases the user may see", async () => {
    const all = await listQuotesForStaff(db, member);
    expect(all).toMatchObject({ total: 1, page: 1, pages: 1 });
    expect(all.rows[0]!.quote.id).toBe(quoteId);
    expect((await listQuotesForStaff(db, member, { q: c.number })).total).toBe(1);
    expect((await listQuotesForStaff(db, member, { q: "no such thing" })).total).toBe(0);
    expect((await listQuotesForStaff(db, member, { status: "sent" })).total).toBe(1);
    expect((await listQuotesForStaff(db, member, { status: "approved" })).total).toBe(0);
    // An unknown status in the URL is ignored rather than failing.
    expect((await listQuotesForStaff(db, member, { status: "bogus" })).total).toBe(1);
    expect((await listQuotesForStaff(db, member, { from: today, to: today })).total).toBe(1);
    expect((await listQuotesForStaff(db, member, { from: addDays(today, 1) })).total).toBe(0);
    expect((await listQuotesForStaff(db, member, { page: 2 })).rows).toHaveLength(0);
    expect((await listQuotesForStaff(db, other)).total).toBe(0);
    expect((await listQuotesForStaff(db, admin, { q: c.number })).total).toBe(1);
  });
});

describe("Payments: search, filters, sort, paging", () => {
  it("filters by status, provider, amount and day, and sorts by amount", async () => {
    expect((await listPayments(db, member)).total).toBe(2);
    expect((await listPayments(db, member, { status: "pending" })).rows.map((r) => r.p.amountCents)).toEqual([50_00]);
    expect((await listPayments(db, member, { provider: "mock" })).total).toBe(2);
    expect((await listPayments(db, member, { provider: "grow" })).total).toBe(0);
    expect((await listPayments(db, member, { min: "60" })).rows.map((r) => r.p.amountCents)).toEqual([100_00]);
    expect((await listPayments(db, member, { max: "50" })).rows.map((r) => r.p.amountCents)).toEqual([50_00]);
    expect((await listPayments(db, member, { sort: "amount_asc" })).rows.map((r) => r.p.amountCents)).toEqual([50_00, 100_00]);
    expect((await listPayments(db, member, { sort: "amount_desc" })).rows.map((r) => r.p.amountCents)).toEqual([100_00, 50_00]);
    expect((await listPayments(db, member, { sort: "nonsense" })).sort).toBe("date_desc");
    expect((await listPayments(db, member, { q: c.number, from: today, to: today })).total).toBe(2);
    expect((await listPayments(db, member, { to: addDays(today, -1) })).total).toBe(0);
    expect(await paymentProviders(db, member)).toEqual(["mock"]);
    expect((await listPayments(db, other)).total).toBe(0);
    expect(await paymentProviders(db, other)).toEqual([]);
  });
});

describe("Tasks: tabs plus filters", () => {
  const titles = (r: { rows: { task: s.Task }[] }) => r.rows.map((x) => x.task.title).sort();
  it("keeps mine / overdue and adds search, assignee, priority, status and due dates", async () => {
    expect(titles(await listTasksForStaff(db, member, { mine: true }))).toEqual(["Call the bank"]);
    expect(titles(await listTasksForStaff(db, member, { overdue: true }))).toEqual(["Call the bank"]);
    expect(titles(await listTasksForStaff(db, member, {}))).toEqual(["Call the bank", "File the form"]);
    expect(titles(await listTasksForStaff(db, member, { assignee: "none" }))).toEqual(["File the form"]);
    expect(titles(await listTasksForStaff(db, member, { assignee: member.id }))).toEqual(["Call the bank"]);
    expect(titles(await listTasksForStaff(db, member, { priority: "low" }))).toEqual(["File the form"]);
    expect(titles(await listTasksForStaff(db, member, { status: "done" }))).toEqual(["Old step"]);
    expect((await listTasksForStaff(db, member, { status: "all" })).total).toBe(3);
    expect(titles(await listTasksForStaff(db, member, { q: "bank" }))).toEqual(["Call the bank"]);
    expect(titles(await listTasksForStaff(db, member, { q: c.number }))).toEqual(["Call the bank", "File the form"]);
    expect(titles(await listTasksForStaff(db, member, { from: today }))).toEqual(["File the form"]);
    expect(titles(await listTasksForStaff(db, member, { to: today }))).toEqual(["Call the bank"]);
    // Overdue never lists finished tasks, whatever status was asked for.
    expect(titles(await listTasksForStaff(db, member, { overdue: true, status: "done" }))).toEqual(["Call the bank"]);
    expect((await listTasksForStaff(db, other, {})).total).toBe(0);
  });
});

describe("menu counters", () => {
  it("count what waits on the person, only on what they may see, and leave zeros out", async () => {
    expect(await navCounts(db, member)).toEqual({ queue: 1, tasks: 1, conversations: 1 });
    // Nothing waits on another team member: no counters at all (not zeros).
    expect(await navCounts(db, other)).toEqual({});
    // Finance has none of these menu items.
    expect(await navCounts(db, await makeUser(db, "finance"))).toEqual({});
    // Answering the client clears the conversation counter.
    await db.insert(s.messages).values({ caseId: c.id, senderId: member.id, body: "Working on it" });
    expect((await navCounts(db, member)).conversations).toBeUndefined();
    // A new request counts on Incoming, for those who see it (an admin), not for a team member.
    await makeCase(db, await makeUser(db, "customer"));
    expect((await navCounts(db, admin)).inbox).toBeGreaterThan(0);
    expect((await navCounts(db, member)).inbox).toBeUndefined();
  });
});
