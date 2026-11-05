import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assignCase, changeStatus } from "@/lib/services/cases";
import { getCaseFeedback, submitFeedback } from "@/lib/services/feedback";
import { buildReport, resolvePeriod } from "@/lib/services/reports";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});

/** A completed case of a fresh client, handled by a fresh case manager. */
async function completedCase() {
  const manager = await makeUser(db, "case_manager");
  const client = await makeUser(db, "customer");
  const c = await makeCase(db, client, "Done");
  await assignCase(db, admin, c.id, manager.id);
  for (const to of ["under_review", "quote_preparation", "active", "completed"] as const) await changeStatus(db, admin, c.id, to).catch(() => {});
  await db.update(s.cases).set({ status: "completed", completedAt: new Date() }).where(eq(s.cases.id, c.id));
  return { manager, client, c };
}

describe("client satisfaction", () => {
  it("completing a case asks the client for a rating", async () => {
    const manager = await makeUser(db, "case_manager");
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    await assignCase(db, admin, c.id, manager.id);
    await db.update(s.cases).set({ status: "active" }).where(eq(s.cases.id, c.id));
    await changeStatus(db, admin, c.id, "completed");
    const asked = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, client.id), eq(s.notifications.type, "feedback_requested"), eq(s.notifications.channel, "in_app")));
    expect(asked.length).toBe(1);
    expect(asked[0]!.link).toContain("#feedback");
  });

  it("the client rates once, 1 to 5 with an optional comment; the team member is told", async () => {
    const { manager, client, c } = await completedCase();
    await expectCode(submitFeedback(db, manager, c.id, { rating: 5 }), "forbidden");
    await expectCode(submitFeedback(db, await makeUser(db, "customer"), c.id, { rating: 5 }), "not_found");
    await expectCode(submitFeedback(db, client, c.id, { rating: 0 }), "validation");
    await expectCode(submitFeedback(db, client, c.id, { rating: 6 }), "validation");
    await expectCode(submitFeedback(db, client, c.id, { rating: 3.5 }), "validation");
    const f = await submitFeedback(db, client, c.id, { rating: 2, comment: "  Took too long  " });
    expect(f).toMatchObject({ rating: 2, comment: "Took too long", staffId: manager.id, userId: client.id });
    await expectCode(submitFeedback(db, client, c.id, { rating: 5 }), "feedback_exists");
    expect((await getCaseFeedback(db, c.id))!.rating).toBe(2);
    const told = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, manager.id), eq(s.notifications.type, "feedback_received")));
    expect(told[0]!.title).toContain("2");
  });

  it("an open case can't be rated yet", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    await expectCode(submitFeedback(db, client, c.id, { rating: 5 }), "feedback_not_ready");
  });

  it("the reports show the average, the spread, the response rate and each member's rating", async () => {
    const before = await buildReport(db, admin, resolvePeriod({}));
    const a = await completedCase();
    await submitFeedback(db, a.client, a.c.id, { rating: 5, comment: "Excellent" });
    const b = await completedCase();
    await submitFeedback(db, b.client, b.c.id, { rating: 4 });
    const r = await buildReport(db, admin, resolvePeriod({}));
    expect(r.satisfaction.count - before.satisfaction.count).toBe(2);
    expect(r.satisfaction.distribution.find((x) => x.star === 5)!.count - before.satisfaction.distribution.find((x) => x.star === 5)!.count).toBe(1);
    expect(r.satisfaction.average).toBeGreaterThan(0);
    expect(r.satisfaction.recent.some((x) => x.comment === "Excellent")).toBe(true);
    expect(r.team!.find((m) => m.id === a.manager.id)).toMatchObject({ averageRating: 5, ratings: 1 });
    // Finance sees the scores, not the comments.
    const fin = await buildReport(db, await makeUser(db, "finance"), resolvePeriod({}));
    expect(fin.satisfaction.recent).toEqual([]);
  });
});
