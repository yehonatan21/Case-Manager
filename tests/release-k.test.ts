import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assignCase } from "@/lib/services/cases";
import { attentionItems } from "@/lib/services/dashboard";
import { officeToday } from "@/lib/services/queue";
import { addDays } from "@/lib/calendar-view";
import { caseWithSentQuote, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let member: s.User;
let other: s.User;
let mine: s.Case;
let theirs: s.Case;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  member = await makeUser(db, "case_manager");
  other = await makeUser(db, "case_manager");
  const client = await makeUser(db, "customer");
  let quoteId: string;
  ({ c: mine, quoteId } = await caseWithSentQuote(db, client, member));
  theirs = await makeCase(db, await makeUser(db, "customer"), "Someone else's case");
  await assignCase(db, admin, theirs.id, other.id);
  const today = officeToday();
  await db.insert(s.tasks).values([
    { caseId: mine.id, title: "My late task", assigneeId: member.id, dueDate: addDays(today, -2) },
    { caseId: theirs.id, title: "Their late task", assigneeId: other.id, dueDate: addDays(today, -2) },
  ]);
  // A meeting later today on my case.
  const start = new Date(Date.now() + 2 * 3600000);
  await db.insert(s.meetings).values({ caseId: mine.id, staffId: member.id, startAt: start, endAt: new Date(start.getTime() + 30 * 60000) });
  // A payment that failed, and a payment document that couldn't be issued.
  const [p] = await db.insert(s.payments).values({ caseId: mine.id, quoteId, provider: "mock", amountCents: 1000, currency: "ILS", status: "failed" }).returning();
  const [ok] = await db.insert(s.payments).values({ caseId: mine.id, quoteId, provider: "mock", amountCents: 1000, currency: "ILS", status: "succeeded", paidAt: new Date() }).returning();
  await db.insert(s.invoices).values({ paymentId: ok!.id, caseId: mine.id, provider: "greeninvoice", status: "failed", error: "Bad key" });
  void p;
});

const reasons = (items: { reason: string; caseId: string }[], caseId?: string) =>
  items
    .filter((i) => !caseId || i.caseId === caseId)
    .map((i) => i.reason)
    .sort();

describe("attention center", () => {
  it("'mine' keeps my tasks and meetings, not a colleague's", async () => {
    const items = await attentionItems(db, member, 24, { scope: "mine" });
    expect(reasons(items, mine.id)).toEqual(expect.arrayContaining(["meeting_today", "overdue_task"]));
    expect(items.some((i) => i.caseId === theirs.id)).toBe(false);
    // Each item goes straight to where it's handled.
    expect(items.find((i) => i.reason === "overdue_task")!.href).toBe(`/admin/cases/${mine.id}?tab=tasks`);
    expect(items.find((i) => i.reason === "meeting_today")!.href).toBe(`/admin/cases/${mine.id}?tab=meetings`);
    expect(items.find((i) => i.reason === "meeting_today")!.vars.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("'all' shows everything the person may see", async () => {
    const all = await attentionItems(db, admin, 24, { scope: "all" });
    expect(all.some((i) => i.caseId === theirs.id && i.reason === "overdue_task")).toBe(true);
    // The default (as before) is everything.
    expect((await attentionItems(db, admin, 24)).length).toBe(all.length);
  });

  it("failed payments and payment documents go to those who handle payments", async () => {
    const forAdmin = reasons(await attentionItems(db, admin, 24, { scope: "mine" }), mine.id);
    expect(forAdmin).toEqual(expect.arrayContaining(["invoice_failed", "payment_failed"]));
    const finance = await makeUser(db, "finance");
    expect(reasons(await attentionItems(db, finance, 24, { scope: "mine" }), mine.id)).toEqual(expect.arrayContaining(["invoice_failed", "payment_failed"]));
    // A case manager doesn't get them, even on their own case.
    expect(reasons(await attentionItems(db, member, 24, { scope: "all" }), mine.id)).not.toContain("payment_failed");
  });

  it("new requests are 'mine' for those who take them", async () => {
    const fresh = await makeCase(db, await makeUser(db, "customer"), "Brand new");
    expect((await attentionItems(db, member, 24, { scope: "mine" })).some((i) => i.caseId === fresh.id && i.reason === "new_request")).toBe(true);
    const staff = await makeUser(db, "staff");
    expect((await attentionItems(db, staff, 24, { scope: "mine" })).some((i) => i.caseId === fresh.id)).toBe(false);
  });
});
