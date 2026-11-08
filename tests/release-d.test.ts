import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assignCase, getCaseBundle, listCustomerCases } from "@/lib/services/cases";
import { approveQuote } from "@/lib/services/quotes";
import { completeMockPayment, createCheckout } from "@/lib/services/payments";
import { addExpense, addTime, buildProfitReport, caseTimeSummary, closeForgottenTimers, deleteTime, setHourlyCost, startTimer, stopTimer } from "@/lib/services/time";
import { updateDocumentDetails } from "@/lib/services/documents";
import { fillDocumentDetailsFromAi } from "@/lib/services/copilot";
import { addCompanyContact, getCompany, makeCompany, removeCompanyContact, updateCompanyContact } from "@/lib/services/companies";
import { checkDocuments, cleanDetails, namesMatch } from "@/lib/doc-checks";
import { caseAccess } from "@/lib/auth/permissions";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

describe("time and profit", () => {
  it("one timer at a time; manual entries; staff change only their own time", async () => {
    const staff = await makeUser(db, "staff");
    const other = await makeUser(db, "staff");
    const manager = await makeUser(db, "case_manager");
    const c1 = await makeCase(db, await makeUser(db, "customer"));
    const c2 = await makeCase(db, await makeUser(db, "customer"));
    for (const c of [c1, c2]) await assignCase(db, admin, c.id, staff.id);
    await db.insert(s.tasks).values({ caseId: c1.id, title: "Help", assigneeId: other.id });
    await expectCode(startTimer(db, await makeUser(db, "staff"), c1.id), "not_found");
    const t1 = await startTimer(db, staff, c1.id);
    await db.update(s.timeEntries).set({ startedAt: new Date(Date.now() - 50 * 60 * 1000) }).where(eq(s.timeEntries.id, t1.id));
    // Starting on another case stops the first one.
    await startTimer(db, staff, c2.id);
    const [stopped] = await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, t1.id));
    expect(stopped).toMatchObject({ minutes: 50, startedAt: null });
    const e2 = await stopTimer(db, staff, c2.id, "Read the file");
    expect(e2).toMatchObject({ minutes: 1, note: "Read the file" });

    await expectCode(addTime(db, staff, c1.id, { minutes: 0, date: today() }), "validation");
    const mine = await addTime(db, staff, c1.id, { minutes: 90, date: today(), note: "Forms", billable: false });
    const theirs = await addTime(db, other, c1.id, { minutes: 30, date: today() });
    await expectCode(deleteTime(db, staff, theirs.id), "forbidden");
    await assignCase(db, admin, c1.id, manager.id);
    await deleteTime(db, manager, theirs.id);
    const sum = await caseTimeSummary(db, manager, c1.id);
    expect(sum).toMatchObject({ minutes: 140, billableMinutes: 50, money: null });
    expect(sum.entries.find((e) => e.id === mine.id)).toMatchObject({ note: "Forms", billable: false });
  });

  it("profit = paid revenue before VAT − time at cost rates − expenses, for admins and finance only", async () => {
    const client = await makeUser(db, "customer");
    const worker = await makeUser(db, "case_manager");
    await expectCode(setHourlyCost(db, worker, worker.id, 10000), "forbidden");
    await setHourlyCost(db, admin, worker.id, 20000); // 200 an hour
    const { c, quoteId } = await caseWithSentQuote(db, client, worker); // 1000 + 18% VAT
    await approveQuote(db, client, quoteId, null);
    const { paymentId } = await createCheckout(db, client, quoteId);
    await completeMockPayment(db, client, paymentId, "succeeded");
    await addTime(db, worker, c.id, { minutes: 120, date: today() });
    await addExpense(db, worker, c.id, { description: "Government fee", amountCents: 15000, date: today() });
    const finance = await makeUser(db, "finance");
    const sum = await caseTimeSummary(db, finance, c.id);
    expect(sum.money).toMatchObject({ revenueCents: 100000, laborCents: 40000, expensesCents: 15000, profitCents: 45000, marginPct: 45, unratedMinutes: 0 });
    expect((await caseTimeSummary(db, worker, c.id)).money).toBeNull();

    const period = { from: today(), to: today() };
    const report = await buildProfitReport(db, admin, period, "ILS");
    expect(report!.money!.byService.find((x) => x.category === c.serviceCategory)!.revenueCents).toBeGreaterThanOrEqual(100000);
    expect(report!.byMember.find((m) => m.id === worker.id)).toMatchObject({ minutes: 120, laborCents: 40000 });
    const managerView = await buildProfitReport(db, worker, period, "ILS");
    expect(managerView!.money).toBeNull();
    expect(JSON.stringify(managerView)).not.toContain("laborCents");
    expect(await buildProfitReport(db, await makeUser(db, "staff"), period, "ILS")).toBeNull();
  });

  it("timers forgotten overnight are stopped at 8 hours", async () => {
    const staff = await makeUser(db, "staff");
    const c = await makeCase(db, await makeUser(db, "customer"));
    await assignCase(db, admin, c.id, staff.id);
    const t = await startTimer(db, staff, c.id);
    await db.update(s.timeEntries).set({ startedAt: new Date(Date.now() - 15 * 3600 * 1000) }).where(eq(s.timeEntries.id, t.id));
    expect(await closeForgottenTimers(db)).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, t.id)))[0]).toMatchObject({ minutes: 480, startedAt: null });
  });
});

describe("document checks", () => {
  it("compare names word by word within a script, and flag expiry, ID and birth-date differences", () => {
    expect(namesMatch("Noa Levi", "noa  LEVI")).toBe(true);
    expect(namesMatch("Noa Rachel Levi", "Noa Levi")).toBe(true);
    expect(namesMatch("Noa Levi", "Dana Levi")).toBe(false);
    expect(namesMatch("נועה לוי", "Noa Levi")).toBe(true);
    expect(namesMatch("נוֹעָה לֵוִי", "נועה לוי")).toBe(true);
    const day = "2026-11-08";
    const f = checkDocuments(
      [
        { id: "p", title: "Passport", details: { fullName: "Noa Levi", idNumber: "123456789", birthDate: "1990-01-01", expiryDate: "2026-12-31" } },
        { id: "i", title: "ID card", details: { fullName: "Dana Levi", idNumber: "0123456780", birthDate: "1990-02-01", expiryDate: "2026-10-01" } },
        { id: "x", title: "Scan", details: { source: "ai", fullName: "Noa Levi" }, readable: false },
      ],
      "Noa Levi",
      day,
    );
    const kinds = (id: string) => f.filter((x) => x.documentId === id).map((x) => x.kind).sort();
    expect(kinds("p")).toEqual(["expiring"]);
    expect(kinds("i")).toEqual(["birth_mismatch", "expired", "id_mismatch", "name_mismatch"]);
    expect(kinds("x")).toEqual(["unconfirmed", "unreadable"]);
    expect(cleanDetails({ fullName: "  ", birthDate: "1/1/90" }, "staff")).toBeNull();
    // Without a client name, documents are compared with each other.
    const noClient = checkDocuments([{ id: "a", title: "A", details: { fullName: "Noa Levi" } }, { id: "b", title: "B", details: { fullName: "Dana Levi" } }], "", day);
    expect(noClient.map((x) => [x.documentId, x.kind])).toEqual([["b", "name_mismatch"]]);
  });

  it("staff confirm the details; the AI only suggests when it can read the file", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    const [doc] = await db.insert(s.documents).values({ caseId: c.id, title: "Passport" }).returning();
    await expectCode(updateDocumentDetails(db, client, doc!.id, { fullName: "x" }), "forbidden");
    const saved = await updateDocumentDetails(db, admin, doc!.id, { fullName: " Noa Levi ", expiryDate: "2030-01-01", birthDate: "not a date" });
    expect(saved).toEqual({ fullName: "Noa Levi", expiryDate: "2030-01-01", source: "staff" });
    const [row] = await db.select().from(s.documents).where(eq(s.documents.id, doc!.id));
    expect(row!.detailsConfirmedById).toBe(admin.id);
    // No file: nothing to read.
    await expectCode(fillDocumentDetailsFromAi(db, admin, doc!.id, "en"), "not_found");
    // Clients never see the details.
    const view = await getCaseBundle(db, client, c.id);
    expect(view.documents.find((x) => x.id === doc!.id)).toBeTruthy();
  });
});

describe("company accounts", () => {
  it("contacts see the company's cases by their access; only owners and billing contacts approve and pay", async () => {
    const owner = await makeUser(db, "customer");
    const [ownerCustomer] = await db.select().from(s.customers).where(eq(s.customers.userId, owner.id));
    await expectCode(makeCompany(db, await makeUser(db, "staff"), ownerCustomer!.id, { name: "Orbit Ltd" }), "forbidden");
    await makeCompany(db, admin, ownerCustomer!.id, { name: "Orbit Ltd", businessId: "515555555" });
    const stamp = Date.now();
    const contactId = await addCompanyContact(db, admin, ownerCustomer!.id, { name: "Office Manager", email: `office-${stamp}@orbit.test`, role: "contact", access: "all" });
    const billingId = await addCompanyContact(db, admin, ownerCustomer!.id, { name: "Finance", email: `finance-${stamp}@orbit.test`, role: "billing", access: "all" });
    const ownOnlyId = await addCompanyContact(db, admin, ownerCustomer!.id, { name: "Intern", email: `intern-${stamp}@orbit.test`, role: "contact", access: "own" });
    await expectCode(addCompanyContact(db, admin, ownerCustomer!.id, { name: "Staff", email: admin.email, role: "contact", access: "all" }), "staff_email");
    const company = await getCompany(db, ownerCustomer!.id);
    expect(company!.members.map((m) => m.role).sort()).toEqual(["billing", "contact", "contact", "owner"]);
    const user = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0]!;
    const contact = await user(contactId);
    const billing = await user(billingId);
    const intern = await user(ownOnlyId);

    const { c, quoteId } = await caseWithSentQuote(db, owner);
    expect((await listCustomerCases(db, contact)).map((x) => [x.id, x.openedFor])).toContainEqual([c.id, owner.name]);
    expect((await listCustomerCases(db, intern)).some((x) => x.id === c.id)).toBe(false);
    await expectCode(getCaseBundle(db, intern, c.id), "not_found");
    const seen = await getCaseBundle(db, contact, c.id);
    expect(seen.access).toMatchObject({ view: true, isClient: true, pay: false, internal: false });
    await expectCode(approveQuote(db, contact, quoteId, null), "forbidden");
    await approveQuote(db, billing, quoteId, null);

    // A company keeps an owner; a removed contact loses access.
    await expectCode(updateCompanyContact(db, admin, ownerCustomer!.id, { role: "contact", access: "all" }), "validation");
    const [contactCustomer] = await db.select().from(s.customers).where(eq(s.customers.userId, contactId));
    await removeCompanyContact(db, admin, contactCustomer!.id);
    await expectCode(getCaseBundle(db, contact, c.id), "not_found");
  });

  it("signing follows the role too", () => {
    const base = { caseAssigneeId: null, caseCustomerUserId: "owner" };
    const colleague = { id: "x", role: "customer" as const };
    expect(caseAccess({ user: colleague, ...base, companyRole: "signatory" })).toMatchObject({ view: true, sign: true, pay: false });
    expect(caseAccess({ user: colleague, ...base, companyRole: "billing" })).toMatchObject({ sign: false, pay: true });
    expect(caseAccess({ user: colleague, ...base, companyRole: null }).view).toBe(false);
    expect(caseAccess({ user: { id: "owner", role: "customer" }, ...base })).toMatchObject({ pay: true, sign: true });
  });
});
