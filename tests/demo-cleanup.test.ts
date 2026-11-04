import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { seedDemo } from "@/lib/db/seed";
import { assignCase, getCaseBundle } from "@/lib/services/cases";
import { postMessage } from "@/lib/services/messages";
import { createTasks } from "@/lib/services/tasks";
import { DEMO_EMAILS, removeDemoData } from "@/lib/services/demo-cleanup";
import { getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
const count = async (t: Parameters<ReturnType<Database["select"]>["from"]>[0]) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n;

beforeAll(async () => {
  db = await setupDb();
  await seedDemo(db);
});

describe("removing demo data", () => {
  let realCaseId: string;
  let realCustomer: s.User;

  beforeAll(async () => {
    // A real customer whose request was handled by the demo manager while demo mode was on.
    realCustomer = await makeUser(db, "customer", { email: "real.person@gmail.com" });
    realCaseId = (await makeCase(db, realCustomer, "Real request")).id;
    const [manager] = await db.select().from(s.users).where(eq(s.users.email, "manager@example.com"));
    await assignCase(db, await getAdmin(db), realCaseId, manager!.id);
    await postMessage(db, manager!, realCaseId, { body: "Hello from the demo manager", kind: "thread" });
    await createTasks(db, manager!, realCaseId, [{ title: "Follow up", assigneeId: manager!.id }]);
  });

  it("previews without changing anything", async () => {
    const before = await count(s.cases);
    const r = await removeDemoData(db, { apply: false });
    expect(r.applied).toBe(false);
    expect(r.users.sort()).toEqual([...DEMO_EMAILS].sort());
    expect(r.cases).toBe(4);
    expect(r.payments).toBeGreaterThan(0);
    expect(r.references["cases.assignee_id"]).toBeGreaterThan(0);
    expect(await count(s.cases)).toBe(before);
  });

  it("removes demo accounts and their requests, keeps real data and the admin", async () => {
    const r = await removeDemoData(db, { apply: true });
    expect(r.applied).toBe(true);
    expect(await db.select().from(s.users).where(inArray(s.users.email, DEMO_EMAILS))).toHaveLength(0);
    const cases = await db.select().from(s.cases);
    expect(cases.map((c) => c.id)).toEqual([realCaseId]);
    expect(cases[0]!.assigneeId).toBeNull();
    expect(await count(s.payments)).toBe(0);
    expect(await db.select().from(s.organizations).where(eq(s.organizations.businessId, "515000000"))).toHaveLength(0);

    // The real request is intact and still readable by its customer, including the demo manager's message.
    const b = await getCaseBundle(db, realCustomer, realCaseId);
    expect(b.messages.some((m) => m.body === "Hello from the demo manager")).toBe(true);
    const [task] = await db.select().from(s.tasks).where(eq(s.tasks.caseId, realCaseId));
    expect(task?.assigneeId).toBeNull();

    expect((await getAdmin(db)).email).toBe("admin@example.com");
    expect((await db.select().from(s.settings)).length).toBeGreaterThan(0);
    expect((await db.select().from(s.priceListItems)).length).toBeGreaterThan(0);
  });

  it("is safe to run again", async () => {
    const r = await removeDemoData(db, { apply: true });
    expect(r.users).toEqual([]);
    expect(r.applied).toBe(false);
  });
});
