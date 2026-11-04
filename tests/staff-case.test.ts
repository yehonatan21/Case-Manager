import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { createCaseForCustomer, getCaseBundle, listCustomerCases, caseWithAccess } from "@/lib/services/cases";
import { requestLoginCode } from "@/lib/services/auth";
import { generateCaseSummary } from "@/lib/services/copilot";
import { expectCode, getAdmin, makeUser, setupDb } from "./helpers";

let db: Database;
let manager: s.User, otherManager: s.User, customer: s.User, customerId: string;
const request = { title: "Work visa renewal", description: "Called on the phone; visa expires next month.", serviceCategory: "immigration_visa", urgency: "high" as const };

beforeAll(async () => {
  db = await setupDb();
  manager = await makeUser(db, "case_manager");
  otherManager = await makeUser(db, "case_manager");
  customer = await makeUser(db, "customer");
  customerId = (await db.select().from(s.customers).where(eq(s.customers.userId, customer.id)))[0]!.id;
});

const notificationsFor = (userId: string, caseId: string) =>
  db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.caseId, caseId)));

describe("case managers opening a request for a client", () => {
  it("for an existing client: assigned to the manager, visible to the client, client notified", async () => {
    const { case: c, customerCreated } = await createCaseForCustomer(db, manager, { customer: { id: customerId }, ...request });
    expect(customerCreated).toBe(false);
    expect(c).toMatchObject({ assigneeId: manager.id, status: "under_review", urgency: "high", serviceCategory: "immigration_visa" });
    expect(c.number).toMatch(/^CASE-\d{4}-\d{4}$/);

    expect((await listCustomerCases(db, customer)).some((x) => x.id === c.id)).toBe(true);
    const b = await getCaseBundle(db, customer, c.id);
    expect(b.events.some((e) => e.type === "case_opened_by_staff")).toBe(true);
    expect((await notificationsFor(customer.id, c.id)).map((n) => n.type)).toContain("case_opened_for_you");

    // Assigned, so another case manager can't see it.
    await expectCode(caseWithAccess(db, otherManager, c.id), "not_found");
  });

  it("left unassigned: goes to the inbox and the other managers are told", async () => {
    const { case: c } = await createCaseForCustomer(db, manager, { customer: { id: customerId }, ...request, assignToMe: false });
    expect(c).toMatchObject({ assigneeId: null, status: "submitted" });
    expect((await notificationsFor(otherManager.id, c.id)).map((n) => n.type)).toContain("new_request");
    expect(await notificationsFor(manager.id, c.id)).toHaveLength(0);
  });

  it("for a new client: creates an account they can sign in to, without terms or AI consent", async () => {
    const email = `New.Client.${Date.now()}@Example.com`;
    const { case: c, customerCreated } = await createCaseForCustomer(db, manager, {
      customer: { email, name: "New Client", phone: "050-1234567", customerType: "company", organizationName: "Client Ltd", locale: "en" },
      ...request,
    });
    expect(customerCreated).toBe(true);
    const [u] = await db.select().from(s.users).where(eq(s.users.email, email.toLowerCase()));
    expect(u).toMatchObject({ role: "customer", status: "active", locale: "en", termsAcceptedAt: null, aiConsentAt: null });
    expect(c.locale).toBe("en");
    const [org] = await db.select({ name: s.organizations.name }).from(s.customers).innerJoin(s.organizations, eq(s.organizations.id, s.customers.organizationId)).where(eq(s.customers.userId, u!.id));
    expect(org?.name).toBe("Client Ltd");

    // The client can sign in with that email, and sees the request.
    expect((await requestLoginCode(db, { email, ip: null, locale: "en", purpose: "login" })).devCode).toMatch(/^\d{6}$/);
    expect((await listCustomerCases(db, u!)).map((x) => x.id)).toEqual([c.id]);
    // No AI processing without the client's own consent.
    await expectCode(generateCaseSummary(db, manager, c.id, "en"), "forbidden");

    // Typing the same email again reuses the account instead of creating a second one.
    const again = await createCaseForCustomer(db, manager, { customer: { email, name: "Someone else", customerType: "private", locale: "he" }, ...request });
    expect(again.customerCreated).toBe(false);
    expect((await listCustomerCases(db, u!)).length).toBe(2);
  });

  it("won't attach a request to a staff account or an unknown client", async () => {
    await expectCode(createCaseForCustomer(db, manager, { customer: { email: otherManager.email, name: "x", customerType: "private", locale: "he" }, ...request }), "conflict");
    await expectCode(createCaseForCustomer(db, manager, { customer: { id: "00000000-0000-0000-0000-000000000000" }, ...request }), "not_found");
    const disabled = await makeUser(db, "customer", { status: "disabled" });
    const [dc] = await db.select().from(s.customers).where(eq(s.customers.userId, disabled.id));
    await expectCode(createCaseForCustomer(db, manager, { customer: { id: dc!.id }, ...request }), "account_disabled");
  });

  it("only admins and case managers can do it", async () => {
    expect((await createCaseForCustomer(db, await getAdmin(db), { customer: { id: customerId }, ...request })).case.assigneeId).toBeTruthy();
    for (const role of ["staff", "finance", "customer"] as const) {
      await expectCode(createCaseForCustomer(db, await makeUser(db, role), { customer: { id: customerId }, ...request }), "forbidden");
    }
  });
});
