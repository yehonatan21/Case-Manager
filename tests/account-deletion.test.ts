import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import { approveQuote } from "@/lib/services/quotes";
import { completeMockPayment, createCheckout } from "@/lib/services/payments";
import { dispatchPendingInvoices } from "@/lib/services/invoices";
import { uploadCaseDocument } from "@/lib/services/documents";
import { postMessage } from "@/lib/services/messages";
import { requestLoginCode } from "@/lib/services/auth";
import { DELETED_CASE_TITLE, deleteCustomerAccount, deletionPreview } from "@/lib/services/account-deletion";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
const pdf = (name = "passport.pdf") => ({ name, data: Buffer.from("%PDF-1.4 test") });
const one = async <T>(p: Promise<T[]>) => (await p)[0];

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});

/** A client with one paid case (with its receipt PDF), one unpaid case, a message and an uploaded document in each. */
async function clientWithHistory() {
  const client = await makeUser(db, "customer", { locale: "en" });
  await db.update(s.users).set({ phone: "050-1234567", whatsappPhone: "972501234567", whatsappOptInAt: new Date() }).where(eq(s.users.id, client.id));
  const { c: paid, quoteId } = await caseWithSentQuote(db, client);
  await approveQuote(db, client, quoteId, "203.0.113.9");
  const { paymentId } = await createCheckout(db, client, quoteId);
  await completeMockPayment(db, client, paymentId, "succeeded");
  await dispatchPendingInvoices(db);
  const unpaid = await makeCase(db, client, "My private matter");
  for (const c of [paid, unpaid]) {
    await postMessage(db, client, c.id, { body: "Here is my ID number 123456782", kind: "thread" });
    await uploadCaseDocument(db, client, c.id, { file: pdf() });
  }
  return { client, paid, unpaid, paymentId, quoteId };
}

describe("deleting a client's account", () => {
  it("previews what will happen", async () => {
    const { client } = await clientWithHistory();
    expect(await deletionPreview(db, client.id)).toEqual({ cases: 2, paidCases: 1, openCases: 2 });
  });

  it("erases the person and their unpaid cases, and keeps payments, invoices and receipts", async () => {
    const { client, paid, unpaid, paymentId, quoteId } = await clientWithHistory();
    const invoice = await one(db.select().from(s.invoices).where(eq(s.invoices.paymentId, paymentId)));
    expect(invoice?.documentId).toBeTruthy();
    const receiptFile = await one(db.select().from(s.documentFiles).where(eq(s.documentFiles.documentId, invoice!.documentId!)));
    const otherFiles = await db
      .select({ key: s.documentFiles.storageKey })
      .from(s.documentFiles)
      .innerJoin(s.documents, eq(s.documents.id, s.documentFiles.documentId))
      .where(inArray(s.documents.caseId, [paid.id, unpaid.id]));
    const uploaded = otherFiles.map((f) => f.key).filter((k) => k !== receiptFile!.storageKey);
    expect(uploaded).toHaveLength(2);
    await requestLoginCode(db, { email: client.email, ip: null, locale: "en" }).catch(() => {});

    const summary = await deleteCustomerAccount(db, client, client.id, client.email.toUpperCase());
    expect(summary).toMatchObject({ erasedCases: 1, keptCases: 1, files: 2 });

    // The person.
    const u = await one(db.select().from(s.users).where(eq(s.users.id, client.id)));
    expect(u).toMatchObject({ name: "—", phone: null, whatsappPhone: null, status: "disabled", emailNotifications: false });
    expect(u!.email).toBe(`deleted-${client.id}@deleted.invalid`);
    expect(u!.deletedAt).toBeInstanceOf(Date);
    for (const t of [s.sessions, s.notifications, s.pushSubscriptions, s.nativePushTokens, s.caseReads] as const) {
      expect(await db.select().from(t).where(eq(t.userId, client.id)), "rows left").toHaveLength(0);
    }
    expect(await db.select().from(s.authCodes).where(eq(s.authCodes.email, client.email))).toHaveLength(0);
    expect(await db.select().from(s.intakeSessions).where(eq(s.intakeSessions.userId, client.id))).toHaveLength(0);

    // The unpaid case is gone, with everything in it.
    expect(await db.select().from(s.cases).where(eq(s.cases.id, unpaid.id))).toHaveLength(0);
    expect(await db.select().from(s.messages).where(eq(s.messages.caseId, unpaid.id))).toHaveLength(0);

    // The paid case: only its number, the quote, the payment, the invoice and the receipt PDF.
    const kept = await one(db.select().from(s.cases).where(eq(s.cases.id, paid.id)));
    expect(kept).toMatchObject({ number: paid.number, title: DELETED_CASE_TITLE, description: "", goal: "", intakeSummary: null, status: "cancelled" });
    expect(await db.select().from(s.messages).where(eq(s.messages.caseId, paid.id))).toHaveLength(0);
    expect(await db.select().from(s.caseEvents).where(eq(s.caseEvents.caseId, paid.id))).toHaveLength(0);
    const docs = await db.select().from(s.documents).where(eq(s.documents.caseId, paid.id));
    expect(docs.map((d) => d.id)).toEqual([invoice!.documentId]);
    expect(await one(db.select().from(s.payments).where(eq(s.payments.id, paymentId)))).toMatchObject({ status: "succeeded" });
    expect(await one(db.select().from(s.invoices).where(eq(s.invoices.paymentId, paymentId)))).toMatchObject({ status: "issued" });
    expect(await one(db.select().from(s.quotes).where(eq(s.quotes.id, quoteId)))).toMatchObject({ status: "approved", approvalIp: null });
    expect((await storage().get(receiptFile!.storageKey)).length).toBeGreaterThan(0);
    for (const key of uploaded) await expect(storage().get(key)).rejects.toThrow();

    // Recorded in the activity log, without personal details.
    const log = await one(db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, client.id)));
    expect(log).toMatchObject({ action: "account.deleted", actorId: null });
    expect(JSON.stringify(log!.details)).not.toContain(client.email);

    // Gone for good.
    await expectCode(deleteCustomerAccount(db, client, client.id, client.email), "not_found");
  });

  it("frees the email: the person can sign up again as a new client", async () => {
    const client = await makeUser(db, "customer");
    await deleteCustomerAccount(db, client, client.id, client.email);
    const again = await makeUser(db, "customer", { email: client.email });
    expect(again.id).not.toBe(client.id);
  });

  it("needs the account's email typed to confirm", async () => {
    const client = await makeUser(db, "customer");
    await expectCode(deleteCustomerAccount(db, client, client.id, "someone-else@example.com"), "validation");
    expect((await one(db.select().from(s.users).where(eq(s.users.id, client.id))))!.deletedAt).toBeNull();
  });

  it("an admin can delete a client's account at their request; nobody else can", async () => {
    const client = await makeUser(db, "customer");
    const other = await makeUser(db, "customer");
    const manager = await makeUser(db, "case_manager");
    await expectCode(deleteCustomerAccount(db, other, client.id, client.email), "forbidden");
    await expectCode(deleteCustomerAccount(db, manager, client.id, client.email), "forbidden");
    await deleteCustomerAccount(db, admin, client.id, client.email);
    const log = await one(db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, client.id)));
    expect(log).toMatchObject({ action: "account.deleted", actorId: admin.id });
  });

  it("team members' accounts aren't deleted this way", async () => {
    const staff = await makeUser(db, "staff");
    await expectCode(deleteCustomerAccount(db, staff, staff.id, staff.email), "forbidden");
    await expectCode(deleteCustomerAccount(db, admin, staff.id, staff.email), "forbidden");
  });
});
