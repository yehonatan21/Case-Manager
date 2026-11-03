import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDatabase, setDbOverride, type Database } from "@/lib/db";
import { seedBase } from "@/lib/db/seed";
import * as s from "@/lib/db/schema";
import { createIntake, finishIntake, getIntake, postIntakeMessage } from "@/lib/services/intake";
import { requestLoginCode, verifyLoginCode } from "@/lib/services/auth";
import { submitIntakeAsCase, getCaseBundle, assignCase, changeStatus, caseWithAccess, listCustomerCases } from "@/lib/services/cases";
import { createDraftQuote, updateDraftQuote, sendQuote, approveQuote, computeTotals } from "@/lib/services/quotes";
import { createCheckout, completeMockPayment, applyPaymentEvent } from "@/lib/services/payments";
import { postMessage } from "@/lib/services/messages";
import { requestDocument, uploadCaseDocument, reviewDocument } from "@/lib/services/documents";
import { generateCaseSummary, copilotQuoteDraft, copilotTaskPlan, copilotText } from "@/lib/services/copilot";
import { createTasks } from "@/lib/services/tasks";
import { dashboardMetrics, attentionItems } from "@/lib/services/dashboard";
import { mockProvider, signMockEvent } from "@/lib/payments";
import { AppError } from "@/lib/errors";

let db: Database;
let admin: s.User;

async function signup(email: string, name: string) {
  const { devCode } = await requestLoginCode(db, { email, ip: null, locale: "he" });
  const { user } = await verifyLoginCode(db, {
    email,
    code: devCode!,
    ip: null,
    locale: "he",
    signup: { name, customerType: "private", acceptTerms: true, aiConsent: true },
  });
  return user;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await seedBase(db);
  setDbOverride(db);
  [admin] = await db.select().from(s.users).where(eq(s.users.role, "admin"));
});

describe("end-to-end service flow", () => {
  let customer: s.User;
  let caseId: string;
  let quoteId: string;

  it("runs an intake conversation with the offline assistant", async () => {
    let session = await createIntake(db, {
      message: "אני רוצה לעבור עם המשפחה לגרמניה ולא יודע מאיפה מתחילים",
      locale: "he",
      user: null,
      ownerToken: "owner-1",
      ip: null,
      mode: "chat",
    });
    expect(session.messages).toHaveLength(2);
    expect(session.messages[1]!.role).toBe("assistant");
    expect(session.summary?.service_category).toBe("relocation");
    expect(session.summary?.request_title).toContain("גרמניה");

    session = await postIntakeMessage(db, session, { content: "עבודה" });
    session = await postIntakeMessage(db, session, { content: "אני לא יודע", skipped: true });
    expect(session.summary!.missing_information.length).toBeGreaterThan(0);
    session = await finishIntake(db, session);
    expect(session.readyForReview).toBe(true);

    // Ownership: another browser cannot read this intake.
    await expectCode(getIntake(db, session.id, null, "someone-else"), "not_found");

    customer = await signup("noa@example.com", "נועה כהן");
    const c = await submitIntakeAsCase(db, {
      user: customer,
      session,
      edits: {
        request_title: session.summary!.request_title,
        request_description: session.summary!.request_description,
        customer_goal: session.summary!.customer_goal,
        service_category: session.summary!.service_category,
        urgency: "normal",
        known_facts: session.summary!.known_facts,
        constraints: [],
        missing_information: session.summary!.missing_information,
        additional_notes: "הערה",
      },
    });
    caseId = c.id;
    expect(c.number).toMatch(/^CASE-\d{4}-0001$/);
    expect(c.status).toBe("submitted");
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.userId, admin.id));
    expect(notes.some((n) => n.type === "new_request")).toBe(true);
  });

  it("requires signup details for unknown emails and rejects wrong codes", async () => {
    const { devCode } = await requestLoginCode(db, { email: "new@example.com", ip: null, locale: "en" });
    await expectCode(verifyLoginCode(db, { email: "new@example.com", code: "000000" === devCode ? "111111" : "000000", ip: null, locale: "en" }), "invalid_code");
    await expectCode(verifyLoginCode(db, { email: "new@example.com", code: devCode!, ip: null, locale: "en" }), "signup_required");
  });

  it("isolates customers from each other's cases", async () => {
    const other = await signup("other@example.com", "Other");
    await expectCode(caseWithAccess(db, other, caseId), "not_found");
    expect(await listCustomerCases(db, other)).toHaveLength(0);
  });

  it("lets staff review, clarify and quote", async () => {
    await assignCase(db, admin, caseId, admin.id);
    let b = await getCaseBundle(db, admin, caseId);
    expect(b.case.status).toBe("under_review");

    await postMessage(db, admin, caseId, { body: "מה מדינת היעד?", kind: "thread", isInfoRequest: true });
    b = await getCaseBundle(db, admin, caseId);
    expect(b.case.status).toBe("awaiting_information");
    const cb = await getCaseBundle(db, customer, caseId);
    expect(cb.actions.map((a) => a.type)).toContain("reply");

    await postMessage(db, customer, caseId, { body: "גרמניה", kind: "thread" });
    b = await getCaseBundle(db, admin, caseId);
    expect(b.case.status).toBe("under_review");

    await postMessage(db, admin, caseId, { body: "internal", kind: "internal_note" });
    const custView = await getCaseBundle(db, customer, caseId);
    expect(custView.messages.some((m) => m.kind === "internal_note")).toBe(false);
    expect(custView.events.every((e) => e.visibility === "client")).toBe(true);

    const summary = await generateCaseSummary(db, admin, caseId, "he");
    expect(summary.what_client_wants.length).toBeGreaterThan(0);

    const ai = await copilotQuoteDraft(db, admin, caseId, "he");
    expect(ai.draft.items.length).toBeGreaterThan(0);
    expect(ai.draft.items.every((i) => i.needsPrice || i.unitPriceCents > 0)).toBe(true);

    const q = await createDraftQuote(db, admin, caseId);
    quoteId = q.id;
    await expectCode(sendQuote(db, admin, q.id), "quote_not_sendable");
    await updateDraftQuote(db, admin, q.id, {
      serviceName: "ייעוץ ותכנון מעבר",
      scope: "scope",
      included: "a\nb",
      excluded: "c",
      currency: "ILS",
      taxRate: 18,
      pricesIncludeTax: false,
      paymentTerms: "מלא",
      timeline: "",
      terms: "",
      validUntil: null,
      items: [{ description: "ייעוץ", quantity: 1, unitPriceCents: 100000 }],
      aiRunId: ai.runId,
    });
    const sent = await sendQuote(db, admin, q.id);
    expect(sent.totalCents).toBe(118000);
    b = await getCaseBundle(db, admin, caseId);
    expect(b.case.status).toBe("quote_sent");
    // Customers never see drafts.
    const cv = await getCaseBundle(db, customer, caseId);
    expect(cv.actions[0]?.type).toBe("approve_quote");
  });

  it("approves, rejects a failed payment, then activates exactly once", async () => {
    await expectCode(approveQuote(db, admin, quoteId, null), "forbidden");
    await approveQuote(db, customer, quoteId, "127.0.0.1");
    let b = await getCaseBundle(db, customer, caseId);
    expect(b.case.status).toBe("awaiting_payment");
    expect(b.quotes[0]!.approvalSnapshotHash).toBeTruthy();

    const first = await createCheckout(db, customer, quoteId);
    await completeMockPayment(db, customer, first.paymentId, "failed");
    b = await getCaseBundle(db, customer, caseId);
    expect(b.case.status).toBe("awaiting_payment");
    expect(b.payments.find((p) => p.id === first.paymentId)?.status).toBe("failed");

    const second = await createCheckout(db, customer, quoteId);
    const body = JSON.stringify({ id: "evt_dup_1", type: "payment.succeeded", data: { paymentId: second.paymentId, amountCents: 118000, currency: "ILS" } });
    const evt = await mockProvider.parseWebhook(body, new Headers({ "x-mock-signature": signMockEvent(body) }));
    expect((await applyPaymentEvent(db, evt)).result).toBe("applied");
    expect((await applyPaymentEvent(db, evt)).result).toBe("duplicate");
    b = await getCaseBundle(db, customer, caseId);
    expect(b.case.status).toBe("active");
    expect(b.events.filter((e) => e.type === "payment_succeeded")).toHaveLength(1);
    await expectCode(createCheckout(db, customer, quoteId), "payment_not_allowed");

    // A forged webhook is rejected.
    await expect(mockProvider.parseWebhook(body, new Headers({ "x-mock-signature": "nope" }))).rejects.toBeInstanceOf(AppError);
  });

  it("handles documents, tasks and completion", async () => {
    const doc = await requestDocument(db, admin, caseId, { title: "דרכון", note: "עמוד ראשי" });
    let b = await getCaseBundle(db, customer, caseId);
    expect(b.case.status).toBe("awaiting_client");
    expect(b.actions.some((a) => a.type === "upload")).toBe(true);

    const pdf = Buffer.from("%PDF-1.4\n%test\n");
    await uploadCaseDocument(db, customer, caseId, { file: { name: "passport.pdf", data: pdf }, documentId: doc.id });
    b = await getCaseBundle(db, admin, caseId);
    expect(b.case.status).toBe("active");
    expect(b.documents.find((d) => d.id === doc.id)?.files).toHaveLength(1);

    await expectCode(uploadCaseDocument(db, customer, caseId, { file: { name: "evil.exe", data: Buffer.from("MZ") } }), "file_type_not_allowed");
    await expectCode(uploadCaseDocument(db, customer, caseId, { file: { name: "fake.pdf", data: Buffer.from("not a pdf") } }), "file_type_not_allowed");
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    await expectCode(uploadCaseDocument(db, customer, caseId, { file: { name: "eicar.txt", data: eicar } }), "file_infected");

    await reviewDocument(db, admin, doc.id, { status: "approved" });

    const plan = await copilotTaskPlan(db, admin, caseId, "he");
    expect(plan.tasks.length).toBeGreaterThan(0);
    await createTasks(db, admin, caseId, plan.tasks, { aiRunId: plan.runId });
    const draft = await copilotText(db, admin, caseId, "status_update", "", "he");
    expect(draft.text.length).toBeGreaterThan(10);

    const m = await dashboardMetrics(db, admin);
    expect(m.activeCases).toBe(1);
    await attentionItems(db, admin, 24);

    await changeStatus(db, admin, caseId, "completed");
    b = await getCaseBundle(db, customer, caseId);
    expect(b.case.status).toBe("completed");
    await expectCode(changeStatus(db, admin, caseId, "awaiting_payment"), "invalid_transition");
  });
});

describe("money", () => {
  it("computes VAT on top or included", () => {
    expect(computeTotals([{ quantity: 2, unitPriceCents: 10000 }], 18, false)).toMatchObject({ subtotalCents: 20000, taxCents: 3600, totalCents: 23600 });
    expect(computeTotals([{ quantity: 1, unitPriceCents: 11800 }], 18, true)).toMatchObject({ subtotalCents: 10000, taxCents: 1800, totalCents: 11800 });
  });
});
