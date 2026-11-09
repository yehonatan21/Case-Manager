import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { assignCase, changeStatus, getCaseBundle, getCaseRow } from "@/lib/services/cases";
import {
  approveQuote,
  createDraftQuote,
  declineQuote,
  deleteDraftQuote,
  expireQuotes,
  requestQuoteClarification,
  reviseQuote,
  sendQuote,
  updateDraftQuote,
} from "@/lib/services/quotes";
import { applyPaymentEvent, completeMockPayment, createCheckout, handleWebhook } from "@/lib/services/payments";
import { requestDocument, reviewDocument, uploadCaseDocument } from "@/lib/services/documents";
import { applyTemplate, createTasks, deleteTask, listTasksForStaff, updateTask } from "@/lib/services/tasks";
import { postMessage } from "@/lib/services/messages";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/services/notifications";
import { dashboardMetrics, attentionItems } from "@/lib/services/dashboard";
import { listTemplates } from "@/lib/services/catalog";
import { addDaysIso } from "@/lib/utils";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, quoteInput, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let customer: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  customer = await makeUser(db, "customer", { locale: "en" });
});

describe("quotes", () => {
  it("can't be sent empty, at zero, or already expired, and can't be edited once sent", async () => {
    const c = await makeCase(db, customer);
    const q = await createDraftQuote(db, admin, c.id);
    expect((await getCaseRow(db, c.id)).status).toBe("quote_preparation");
    expect((await createDraftQuote(db, admin, c.id)).id).toBe(q.id); // one draft at a time
    await expectCode(sendQuote(db, admin, q.id), "quote_not_sendable");
    await updateDraftQuote(db, admin, q.id, quoteInput(0));
    await expectCode(sendQuote(db, admin, q.id), "quote_not_sendable");
    await updateDraftQuote(db, admin, q.id, quoteInput(1000, addDaysIso(-1)));
    await expectCode(sendQuote(db, admin, q.id), "quote_not_sendable");
    await updateDraftQuote(db, admin, q.id, quoteInput(1000));
    await sendQuote(db, admin, q.id);
    await expectCode(updateDraftQuote(db, admin, q.id, quoteInput(5)), "quote_not_editable");
    await expectCode(deleteDraftQuote(db, admin, q.id), "quote_not_editable");
    await expectCode(sendQuote(db, admin, q.id), "quote_not_editable");
  });

  it("a revision is a new version that supersedes the previous one when sent", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    const v2 = await reviseQuote(db, admin, quoteId);
    expect(v2.version).toBe(2);
    expect((await reviseQuote(db, admin, quoteId)).id).toBe(v2.id);
    await updateDraftQuote(db, admin, v2.id, quoteInput(200000));
    await sendQuote(db, admin, v2.id);
    const quotes = (await getCaseBundle(db, customer, c.id)).quotes;
    expect(quotes.find((q) => q.id === quoteId)?.status).toBe("superseded");
    await expectCode(approveQuote(db, customer, quoteId, null), "quote_not_approvable");
    expect((await approveQuote(db, customer, v2.id, null)).totalCents).toBe(236000);
  });

  it("expired quotes can't be approved, and the expiry job marks them", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    await db.update(s.quotes).set({ validUntil: addDaysIso(-1) }).where(eq(s.quotes.id, quoteId));
    await expectCode(approveQuote(db, customer, quoteId, null), "quote_expired");
    expect((await getCaseBundle(db, customer, c.id)).actions[0]?.type).toBe("quote_expired");
    expect(await expireQuotes(db)).toBeGreaterThanOrEqual(1);
    const [q] = await db.select().from(s.quotes).where(eq(s.quotes.id, quoteId));
    expect(q?.status).toBe("expired");
  });

  it("clarification keeps the quote approvable and posts the question to the thread", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    await requestQuoteClarification(db, customer, quoteId, "Does this include translation?");
    const b = await getCaseBundle(db, admin, c.id);
    expect(b.quotes[0]?.status).toBe("clarification_requested");
    expect(b.messages.some((m) => m.body.includes("translation"))).toBe(true);
    expect((await approveQuote(db, customer, quoteId, null)).status).toBe("approved");
  });

  it("declining moves the case to declined, and staff can reopen it", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    await declineQuote(db, customer, quoteId, "Too expensive");
    expect((await getCaseRow(db, c.id)).status).toBe("declined");
    await expectCode(approveQuote(db, customer, quoteId, null), "quote_not_approvable");
    await changeStatus(db, admin, c.id, "under_review");
    expect((await getCaseRow(db, c.id)).status).toBe("under_review");
  });
});

describe("payments", () => {
  it("is only possible after approval, and only by the customer", async () => {
    const { quoteId } = await caseWithSentQuote(db, customer);
    await expectCode(createCheckout(db, customer, quoteId), "payment_not_allowed");
    await approveQuote(db, customer, quoteId, null);
    await expectCode(createCheckout(db, admin, quoteId), "forbidden");
    const { url } = await createCheckout(db, customer, quoteId);
    expect(url).toMatch(/^\/pay\/mock\//);
  });

  it("rejects a confirmed payment whose amount doesn't match the quote", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    await approveQuote(db, customer, quoteId, null);
    const { paymentId } = await createCheckout(db, customer, quoteId);
    const r = await applyPaymentEvent(db, { provider: "mock", eventId: "evt_mismatch", kind: "succeeded", paymentId, providerPaymentId: "pi", amountCents: 1, currency: "ILS", raw: {} });
    expect(r.result).toBe("rejected");
    expect((await getCaseRow(db, c.id)).status).toBe("awaiting_payment");
  });

  it("a cancelled checkout leaves the case awaiting payment; a later success activates it once", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    await approveQuote(db, customer, quoteId, null);
    const first = await createCheckout(db, customer, quoteId);
    await completeMockPayment(db, customer, first.paymentId, "cancelled");
    expect((await getCaseRow(db, c.id)).status).toBe("awaiting_payment");
    const second = await createCheckout(db, customer, quoteId);
    await completeMockPayment(db, customer, second.paymentId, "succeeded");
    await expectCode(completeMockPayment(db, customer, "00000000-0000-0000-0000-000000000000", "succeeded"), "not_found");
    expect((await getCaseRow(db, c.id)).status).toBe("active");
    const again = await completeMockPayment(db, customer, second.paymentId, "succeeded");
    expect(again.result).toBe("ignored"); // payment no longer pending
    await expectCode(createCheckout(db, customer, quoteId), "payment_not_allowed");
  });

  it("verifies Stripe webhook signatures and applies the event once", async () => {
    const { c, quoteId } = await caseWithSentQuote(db, customer);
    await approveQuote(db, customer, quoteId, null);
    const [q] = await db.select().from(s.quotes).where(eq(s.quotes.id, quoteId));
    const [p] = await db
      .insert(s.payments)
      .values({ quoteId, caseId: c.id, provider: "stripe", amountCents: q!.totalCents, currency: "ILS", status: "pending" })
      .returning();
    const saved = { stripeSecretKey: env.stripeSecretKey, stripeWebhookSecret: env.stripeWebhookSecret };
    Object.assign(env, { stripeSecretKey: "sk_test_dummy", stripeWebhookSecret: "whsec_test_secret" });
    try {
      const payload = JSON.stringify({
        id: "evt_stripe_1",
        object: "event",
        type: "checkout.session.completed",
        data: { object: { object: "checkout.session", payment_status: "paid", amount_total: q!.totalCents, currency: "ils", payment_intent: "pi_1", metadata: { paymentId: p!.id } } },
      });
      const stripe = new Stripe("sk_test_dummy");
      const good = new Headers({ "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" }) });
      const bad = new Headers({ "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" }) });
      await expectCode(handleWebhook(db, "stripe", payload, bad), "forbidden");
      expect((await handleWebhook(db, "stripe", payload, good)).result).toBe("applied");
      expect((await handleWebhook(db, "stripe", payload, good)).result).toBe("duplicate");
      expect((await getCaseRow(db, c.id)).status).toBe("active");
    } finally {
      Object.assign(env, saved);
    }
  });
});

describe("documents", () => {
  it("request → upload → new version requested → re-upload → approved, with versions kept", async () => {
    const c = await makeCase(db, customer);
    await assignCase(db, admin, c.id, admin.id);
    const doc = await requestDocument(db, admin, c.id, { title: "Passport" });
    expect((await getCaseRow(db, c.id)).status).toBe("awaiting_information");
    await uploadCaseDocument(db, customer, c.id, { file: { name: "p.pdf", data: Buffer.from("%PDF-1.4 v1") }, documentId: doc.id });
    expect((await getCaseRow(db, c.id)).status).toBe("under_review");
    await expectCode(reviewDocument(db, customer, doc.id, { status: "approved" }), "forbidden");
    await reviewDocument(db, admin, doc.id, { status: "needs_new_version", note: "Blurry" });
    let b = await getCaseBundle(db, customer, c.id);
    expect(b.actions.find((a) => a.type === "upload")).toBeTruthy();
    expect(b.documents.find((d) => d.id === doc.id)?.reviewNote).toBe("Blurry");
    await uploadCaseDocument(db, customer, c.id, { file: { name: "p2.pdf", data: Buffer.from("%PDF-1.4 v2") }, documentId: doc.id });
    await reviewDocument(db, admin, doc.id, { status: "approved" });
    b = await getCaseBundle(db, admin, c.id);
    const d = b.documents.find((x) => x.id === doc.id)!;
    expect(d.status).toBe("approved");
    expect(d.files.map((f) => f.version)).toEqual([2, 1]);
  });

  it("enforces the upload size limit", async () => {
    const c = await makeCase(db, customer);
    const big = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(env.maxUploadBytes + 1)]);
    await expectCode(uploadCaseDocument(db, customer, c.id, { file: { name: "big.pdf", data: big } }), "file_too_large");
  });
});

describe("tasks", () => {
  it("creates from a template, tracks completion and overdue, and deletes", async () => {
    const c = await makeCase(db, customer);
    const [tpl] = await listTemplates(db, true);
    const created = await applyTemplate(db, admin, c.id, tpl!.id);
    expect(created).toHaveLength(tpl!.tasks.length);
    const [t1] = await createTasks(db, admin, c.id, [{ title: "Late", dueDate: addDaysIso(-2), assigneeId: admin.id }]);
    expect((await listTasksForStaff(db, admin, { overdue: true })).rows.some((r) => r.task.id === t1!.id)).toBe(true);
    expect((await dashboardMetrics(db, admin)).overdueTasks).toBeGreaterThan(0);
    expect((await attentionItems(db, admin, 24)).some((i) => i.reason === "overdue_task")).toBe(true);
    const done = await updateTask(db, admin, t1!.id, { status: "done" });
    expect(done.completedAt).toBeTruthy();
    expect((await listTasksForStaff(db, admin, { overdue: true })).rows.some((r) => r.task.id === t1!.id)).toBe(false);
    await deleteTask(db, admin, t1!.id);
    await expectCode(updateTask(db, admin, t1!.id, { status: "todo" }), "not_found");
  });
});

describe("notifications", () => {
  it("notifies the customer in their language and tracks read state", async () => {
    const c = await makeCase(db, customer);
    await postMessage(db, admin, c.id, { body: "Hello", kind: "thread" });
    const items = await listNotifications(db, customer);
    expect(items[0]?.title).toMatch(/^New message in case/); // English: the customer's locale
    expect(await unreadCount(db, customer)).toBeGreaterThan(0);
    await markNotificationsRead(db, customer);
    expect(await unreadCount(db, customer)).toBe(0);
    const emails = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, customer.id), eq(s.notifications.channel, "email")));
    expect(emails.length).toBeGreaterThan(0);
  });

  it("doesn't email users who turned email notifications off", async () => {
    const quiet = await makeUser(db, "customer");
    await db.update(s.users).set({ emailNotifications: false }).where(eq(s.users.id, quiet.id));
    const c = await makeCase(db, quiet);
    await postMessage(db, admin, c.id, { body: "Hi", kind: "thread" });
    const emails = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, quiet.id), eq(s.notifications.channel, "email")));
    expect(emails).toHaveLength(0);
    expect(await unreadCount(db, quiet)).toBeGreaterThan(0);
  });
});
