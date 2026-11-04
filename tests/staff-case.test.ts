import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { createCaseForCustomer, getCaseBundle, listCustomerCases, listStaffCases, caseWithAccess, type StaffCaseInput } from "@/lib/services/cases";
import { postMessage } from "@/lib/services/messages";
import { requestLoginCode } from "@/lib/services/auth";
import { generateCaseSummary } from "@/lib/services/copilot";
import { canCreateCasesForClients } from "@/lib/auth/permissions";
import { expectCode, getAdmin, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User, manager: s.User, otherManager: s.User, customer: s.User, customerId: string;
let n = 0;
const uniqueEmail = () => `client-${Date.now().toString(36)}-${++n}@example.com`;
const request = { title: "Work visa renewal", description: "Called on the phone; visa expires next month.", serviceCategory: "immigration_visa", urgency: "high" as const };
const newClient = (over: Partial<Extract<StaffCaseInput["customer"], { email: string }>> = {}) => ({
  email: uniqueEmail(),
  name: "New Client",
  customerType: "private" as const,
  locale: "he" as const,
  ...over,
});

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
  otherManager = await makeUser(db, "case_manager");
  customer = await makeUser(db, "customer", { locale: "en" });
  customerId = (await db.select().from(s.customers).where(eq(s.customers.userId, customer.id)))[0]!.id;
});

const notificationsFor = (userId: string, caseId: string) =>
  db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.caseId, caseId)));
const userByEmail = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email.toLowerCase())))[0];
const auditFor = (entityId: string) => db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, entityId));

describe("who may open a request for a client", () => {
  it("only admins and case managers", async () => {
    expect(["admin", "case_manager"].every((r) => canCreateCasesForClients(r as s.UserRole))).toBe(true);
    expect(["staff", "finance", "customer"].some((r) => canCreateCasesForClients(r as s.UserRole))).toBe(false);
    for (const role of ["staff", "finance", "customer"] as const) {
      const u = await makeUser(db, role);
      await expectCode(createCaseForCustomer(db, u, { customer: { id: customerId }, ...request }), "forbidden");
      await expectCode(createCaseForCustomer(db, u, { customer: newClient(), ...request }), "forbidden");
    }
  });

  it("a refused attempt creates nothing", async () => {
    const email = uniqueEmail();
    await expectCode(createCaseForCustomer(db, await makeUser(db, "staff"), { customer: newClient({ email }), ...request }), "forbidden");
    expect(await userByEmail(email)).toBeUndefined();
  });
});

describe("for an existing client", () => {
  let caseId: string;

  it("assigns to the creator and starts under review", async () => {
    const { case: c, customerCreated } = await createCaseForCustomer(db, manager, { customer: { id: customerId }, ...request, goal: "  Keep working legally  " });
    caseId = c.id;
    expect(customerCreated).toBe(false);
    expect(c).toMatchObject({
      customerId,
      assigneeId: manager.id,
      status: "under_review",
      urgency: "high",
      serviceCategory: "immigration_visa",
      title: request.title,
      description: request.description,
      goal: "Keep working legally",
      intakeSessionId: null,
      locale: "en", // the client's language, not the manager's
    });
    expect(c.reviewedAt).toBeInstanceOf(Date);
    expect(c.number).toMatch(/^CASE-\d{4}-\d{4}$/);
  });

  it("shows up for the client with a client-facing event, and not the internal assignment", async () => {
    expect((await listCustomerCases(db, customer)).some((x) => x.id === caseId)).toBe(true);
    const b = await getCaseBundle(db, customer, caseId);
    const types = b.events.map((e) => e.type);
    expect(types).toContain("case_opened_by_staff");
    expect(types).not.toContain("assigned");
    // Staff see both.
    const staffView = await getCaseBundle(db, manager, caseId);
    expect(staffView.events.map((e) => e.type)).toEqual(expect.arrayContaining(["case_opened_by_staff", "assigned"]));
  });

  it("notifies the client in their language, in the app and by email", async () => {
    const rows = await notificationsFor(customer.id, caseId);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app"]);
    for (const r of rows) {
      expect(r.type).toBe("case_opened_for_you");
      expect(r.title).toMatch(/^A request was opened for you: CASE-/);
      expect(r.link).toBe(`/portal/cases/${caseId}`);
    }
    // Assigned to the creator: nobody else is notified, and not the creator either.
    expect(await notificationsFor(manager.id, caseId)).toHaveLength(0);
    expect(await notificationsFor(otherManager.id, caseId)).toHaveLength(0);
  });

  it("respects a client who turned email notifications off", async () => {
    const quiet = await makeUser(db, "customer");
    await db.update(s.users).set({ emailNotifications: false }).where(eq(s.users.id, quiet.id));
    const [qc] = await db.select().from(s.customers).where(eq(s.customers.userId, quiet.id));
    const { case: c } = await createCaseForCustomer(db, manager, { customer: { id: qc!.id }, ...request });
    expect((await notificationsFor(quiet.id, c.id)).map((r) => r.channel)).toEqual(["in_app"]);
  });

  it("is private to the assigned manager, and the client can reply on it", async () => {
    expect((await listStaffCases(db, manager)).some((x) => x.id === caseId)).toBe(true);
    await expectCode(caseWithAccess(db, otherManager, caseId), "not_found");
    expect((await listStaffCases(db, otherManager)).some((x) => x.id === caseId)).toBe(false);
    await postMessage(db, customer, caseId, { body: "Thanks, here are the details", kind: "thread" });
    expect((await getCaseBundle(db, manager, caseId)).messages.some((m) => m.body === "Thanks, here are the details")).toBe(true);
  });

  it("is audited", async () => {
    expect((await auditFor(caseId)).map((a) => [a.action, a.actorId])).toContainEqual(["case.create_for_customer", manager.id]);
  });

  it("numbers cases one after another", async () => {
    const a = await createCaseForCustomer(db, manager, { customer: { id: customerId }, ...request });
    const b = await createCaseForCustomer(db, manager, { customer: { id: customerId }, ...request });
    const num = (x: string) => Number(x.split("-")[2]);
    expect(num(b.case.number)).toBe(num(a.case.number) + 1);
  });

  it("cleans up the input: trims text and maps an unknown area to 'other'", async () => {
    const { case: c } = await createCaseForCustomer(db, manager, {
      customer: { id: customerId },
      title: "  Spaced title  ",
      description: "  Spaced description  ",
      serviceCategory: "not-a-real-category",
      urgency: "low",
    });
    expect(c).toMatchObject({ title: "Spaced title", description: "Spaced description", serviceCategory: "other", goal: "" });
  });
});

describe("leaving the request unassigned", () => {
  it("goes to the inbox, and the other managers and admins are told (not the creator)", async () => {
    const { case: c } = await createCaseForCustomer(db, manager, { customer: { id: customerId }, ...request, assignToMe: false });
    expect(c).toMatchObject({ assigneeId: null, status: "submitted", reviewedAt: null });
    expect((await notificationsFor(otherManager.id, c.id)).map((r) => r.type)).toContain("new_request");
    expect((await notificationsFor(admin.id, c.id)).map((r) => r.type)).toContain("new_request");
    expect(await notificationsFor(manager.id, c.id)).toHaveLength(0);
    // Unassigned requests are visible to every case manager.
    await caseWithAccess(db, otherManager, c.id);
    const b = await getCaseBundle(db, manager, c.id);
    expect(b.events.map((e) => e.type)).not.toContain("assigned");
  });

  it("an admin can create one too", async () => {
    const { case: c } = await createCaseForCustomer(db, admin, { customer: { id: customerId }, ...request });
    expect(c.assigneeId).toBe(admin.id);
  });
});

describe("for a new client", () => {
  it("creates an account without terms or AI consent, in the client's language", async () => {
    const email = uniqueEmail();
    const { case: c, customerCreated } = await createCaseForCustomer(db, manager, {
      customer: newClient({ email, name: "  Dana Client  ", phone: " 050-1234567 ", customerType: "company", organizationName: " Client Ltd ", locale: "en" }),
      ...request,
    });
    expect(customerCreated).toBe(true);
    const u = await userByEmail(email);
    expect(u).toMatchObject({ role: "customer", status: "active", name: "Dana Client", phone: "050-1234567", locale: "en", termsAcceptedAt: null, aiConsentAt: null });
    expect(c.locale).toBe("en");
    const [row] = await db.select({ type: s.customers.type, org: s.organizations.name }).from(s.customers).leftJoin(s.organizations, eq(s.organizations.id, s.customers.organizationId)).where(eq(s.customers.userId, u!.id));
    expect(row).toEqual({ type: "company", org: "Client Ltd" });
    expect((await auditFor(u!.id)).map((a) => [a.action, a.actorId])).toContainEqual(["customer.create", manager.id]);
  });

  it("the client can sign in with that email and sees only this request", async () => {
    const email = uniqueEmail();
    const { case: c } = await createCaseForCustomer(db, manager, { customer: newClient({ email }), ...request });
    expect((await requestLoginCode(db, { email, ip: null, locale: "he", purpose: "login" })).devCode).toMatch(/^\d{6}$/);
    expect((await listCustomerCases(db, (await userByEmail(email))!)).map((x) => x.id)).toEqual([c.id]);
  });

  it("keeps AI tools off until the client consents themselves", async () => {
    const { case: c } = await createCaseForCustomer(db, manager, { customer: newClient(), ...request });
    await expectCode(generateCaseSummary(db, manager, c.id, "en"), "forbidden");
    expect(await generateCaseSummary(db, null, c.id, "en")).toBeNull();
  });

  it("stores no organisation for a private client, or a business without a name", async () => {
    for (const customerType of ["private", "business"] as const) {
      const email = uniqueEmail();
      await createCaseForCustomer(db, manager, { customer: newClient({ email, customerType, organizationName: customerType === "private" ? "Ignored Ltd" : "  " }), ...request });
      const [cust] = await db.select().from(s.customers).where(eq(s.customers.userId, (await userByEmail(email))!.id));
      expect(cust).toMatchObject({ type: customerType, organizationId: null });
    }
  });

  it("an email that already has a client account reuses it, whatever the case or spacing, and keeps their details", async () => {
    const { case: first } = await createCaseForCustomer(db, manager, { customer: newClient({ email: `  ${customer.email.toUpperCase()}  `, name: "Different Name", locale: "he" }), ...request });
    expect(first.customerId).toBe(customerId);
    expect((await userByEmail(customer.email))!).toMatchObject({ name: customer.name, locale: "en" });
    expect(await db.select().from(s.users).where(eq(s.users.email, customer.email))).toHaveLength(1);
  });

  it("returns customerCreated=false when reusing an account", async () => {
    const email = uniqueEmail();
    expect((await createCaseForCustomer(db, manager, { customer: newClient({ email }), ...request })).customerCreated).toBe(true);
    expect((await createCaseForCustomer(db, manager, { customer: newClient({ email }), ...request })).customerCreated).toBe(false);
  });
});

describe("refusals", () => {
  it("won't attach a request to a staff account", async () => {
    for (const staff of [otherManager, admin, await makeUser(db, "finance")]) {
      await expectCode(createCaseForCustomer(db, manager, { customer: newClient({ email: staff.email }), ...request }), "staff_email");
    }
  });

  it("won't use a disabled client account, picked from the list or typed in", async () => {
    const disabled = await makeUser(db, "customer", { status: "disabled" });
    const [dc] = await db.select().from(s.customers).where(eq(s.customers.userId, disabled.id));
    await expectCode(createCaseForCustomer(db, manager, { customer: { id: dc!.id }, ...request }), "account_disabled");
    await expectCode(createCaseForCustomer(db, manager, { customer: newClient({ email: disabled.email }), ...request }), "account_disabled");
    expect(await listCustomerCases(db, disabled)).toHaveLength(0);
  });

  it("an unknown or malformed client id is 'not found'", async () => {
    await expectCode(createCaseForCustomer(db, manager, { customer: { id: "00000000-0000-0000-0000-000000000000" }, ...request }), "not_found");
    await expectCode(createCaseForCustomer(db, manager, { customer: { id: "not-a-uuid" }, ...request }), "not_found");
    // A user id is not a customer id.
    await expectCode(createCaseForCustomer(db, manager, { customer: { id: customer.id }, ...request }), "not_found");
  });

  it("is all-or-nothing: if the case can't be saved, no client account is left behind", async () => {
    const email = uniqueEmail();
    const before = (await listStaffCases(db, admin, { status: "all" })).length;
    await expect(createCaseForCustomer(db, manager, { customer: newClient({ email }), ...request, urgency: "bogus" as never })).rejects.toThrow();
    expect(await userByEmail(email)).toBeUndefined();
    expect((await listStaffCases(db, admin, { status: "all" })).length).toBe(before);
  });
});
