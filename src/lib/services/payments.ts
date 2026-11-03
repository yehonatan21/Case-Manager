import { and, desc, eq } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { cases, customers, paymentEvents, payments, quotes, users, type User } from "../db/schema";
import { AppError } from "../errors";
import { env } from "../env";
import { paymentProvider, mockProvider, signMockEvent, type NormalizedPaymentEvent } from "../payments";
import { applyStatus, adminCaseLink, caseWithAccess, portalCaseLink, staffCaseScope } from "./cases";
import { addEvent } from "./events";
import { audit } from "./audit";
import { notify, staffRecipients } from "./notifications";
import { customerUserIdOf } from "./cases";

/** Starts a hosted checkout for an approved quote (one payment per quote in the MVP). */
export async function createCheckout(db: Database, actor: User, quoteId: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) throw new AppError("not_found");
  const { c, access } = await caseWithAccess(db, actor, q.caseId);
  if (!access.isClient) throw new AppError("forbidden");
  if (q.status !== "approved" || c.status !== "awaiting_payment") throw new AppError("payment_not_allowed");
  const [paid] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.quoteId, q.id), eq(payments.status, "succeeded")));
  if (paid) throw new AppError("already_paid");

  const provider = paymentProvider();
  const [p] = await db
    .insert(payments)
    .values({ quoteId: q.id, caseId: c.id, provider: provider.name, amountCents: q.totalCents, currency: q.currency, status: "pending", createdById: actor.id })
    .returning();
  const base = `${env.appUrl}${portalCaseLink(c.id)}?tab=quote`;
  const session = await provider.createCheckout({
    paymentId: p!.id,
    amountCents: q.totalCents,
    currency: q.currency,
    description: `${c.number} — ${q.serviceName}`.slice(0, 250),
    customerEmail: actor.email,
    successUrl: `${base}&payment=success`,
    cancelUrl: `${base}&payment=cancelled`,
  });
  await db.update(payments).set({ providerSessionId: session.sessionId, updatedAt: new Date() }).where(eq(payments.id, p!.id));
  await audit(db, { actorId: actor.id, action: "payment.checkout", entityType: "payment", entityId: p!.id, details: { provider: provider.name, amountCents: q.totalCents } });
  return { paymentId: p!.id, url: session.url };
}

/**
 * Applies a verified provider event exactly once. The (provider, event id) ledger makes duplicate
 * deliveries a no-op, and payment state only moves forward from "pending", so a retried or
 * out-of-order event can never double-activate a case or re-notify.
 */
export async function applyPaymentEvent(db: Database, evt: NormalizedPaymentEvent): Promise<{ result: "duplicate" | "ignored" | "applied" | "rejected" }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentEvents)
      .values({ provider: evt.provider, providerEventId: evt.eventId, type: evt.kind, paymentId: evt.paymentId, payload: evt.raw })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (inserted.length === 0) return { result: "duplicate" as const };
    const ledgerId = inserted[0]!.id;
    const setResult = (r: string) => tx.update(paymentEvents).set({ result: r }).where(eq(paymentEvents.id, ledgerId));

    if (evt.kind === "ignored" || !evt.paymentId || !/^[0-9a-f-]{36}$/i.test(evt.paymentId)) {
      await setResult("ignored");
      return { result: "ignored" as const };
    }
    const [p] = await tx.select().from(payments).where(eq(payments.id, evt.paymentId)).for("update");
    if (!p || p.provider !== evt.provider) {
      await setResult("unknown_payment");
      return { result: "ignored" as const };
    }
    if (p.status !== "pending") {
      await setResult(`already_${p.status}`);
      return { result: "ignored" as const };
    }
    const [c] = await tx.select().from(cases).where(eq(cases.id, p.caseId));
    const customerUserId = await customerUserIdOf(tx, c!.customerId);

    if (evt.kind === "succeeded") {
      if (evt.amountCents !== null && (evt.amountCents !== p.amountCents || (evt.currency && evt.currency.toUpperCase() !== p.currency.toUpperCase()))) {
        await tx.update(payments).set({ status: "failed", failureReason: "amount_mismatch", updatedAt: new Date() }).where(eq(payments.id, p.id));
        await audit(tx, { action: "payment.amount_mismatch", entityType: "payment", entityId: p.id, details: { expected: p.amountCents, got: evt.amountCents } });
        await setResult("amount_mismatch");
        return { result: "rejected" as const };
      }
      await tx
        .update(payments)
        .set({ status: "succeeded", paidAt: new Date(), providerPaymentId: evt.providerPaymentId, updatedAt: new Date() })
        .where(eq(payments.id, p.id));
      await addEvent(tx, { caseId: c!.id, type: "payment_succeeded", actorKind: "system", visibility: "client", data: { amount: p.amountCents, currency: p.currency } });
      if (c!.status === "awaiting_payment") await applyStatus(tx, c!, "active", null, { notifyClient: false });
      await notify(tx, {
        userIds: [customerUserId, ...(await staffRecipients(tx, c!))],
        type: "payment_succeeded",
        caseId: c!.id,
        vars: { number: c!.number },
        link: null,
      });
      await audit(tx, { action: "payment.succeeded", entityType: "payment", entityId: p.id, details: { eventId: evt.eventId } });
      await setResult("applied");
      return { result: "applied" as const };
    }

    const status = evt.kind === "failed" ? "failed" : "cancelled";
    await tx.update(payments).set({ status, failureReason: evt.failureReason ?? null, updatedAt: new Date() }).where(eq(payments.id, p.id));
    if (status === "failed") {
      await addEvent(tx, { caseId: c!.id, type: "payment_failed", actorKind: "system", visibility: "client" });
      await notify(tx, { userIds: [customerUserId], type: "payment_failed", caseId: c!.id, vars: { number: c!.number }, link: `${portalCaseLink(c!.id)}?tab=quote` });
    }
    await setResult("applied");
    return { result: "applied" as const };
  });
}

export async function handleWebhook(db: Database, providerName: string, rawBody: string, headers: Headers) {
  const provider = paymentProvider(providerName);
  const evt = await provider.parseWebhook(rawBody, headers);
  return applyPaymentEvent(db, evt);
}

/** Mock checkout: the hosted page posts the outcome, which is turned into a signed webhook and processed. */
export async function completeMockPayment(db: Database, actor: User, paymentId: string, outcome: "succeeded" | "failed" | "cancelled") {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p || p.provider !== "mock") throw new AppError("not_found");
  const { access } = await caseWithAccess(db, actor, p.caseId);
  if (!access.isClient) throw new AppError("forbidden");
  const body = JSON.stringify({
    id: `mock_evt_${crypto.randomUUID()}`,
    type: `payment.${outcome}`,
    data: { paymentId: p.id, providerPaymentId: `mock_pi_${p.id.slice(0, 8)}`, amountCents: p.amountCents, currency: p.currency, reason: outcome === "failed" ? "card_declined" : undefined },
  });
  const headers = new Headers({ "x-mock-signature": signMockEvent(body) });
  const evt = await mockProvider.parseWebhook(body, headers);
  const res = await applyPaymentEvent(db, evt);
  return { ...res, caseId: p.caseId };
}

export async function getPaymentForCheckoutPage(db: DbOrTx, actor: User, paymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw new AppError("not_found");
  const [row] = await db
    .select({ p: payments, serviceName: quotes.serviceName, caseNumber: cases.number })
    .from(payments)
    .innerJoin(quotes, eq(quotes.id, payments.quoteId))
    .innerJoin(cases, eq(cases.id, payments.caseId))
    .where(eq(payments.id, paymentId));
  if (!row) throw new AppError("not_found");
  const { access } = await caseWithAccess(db, actor, row.p.caseId);
  if (!access.isClient) throw new AppError("not_found");
  return row;
}

export async function listPayments(db: DbOrTx, actor: User) {
  return db
    .select({ p: payments, caseNumber: cases.number, caseId: cases.id, customerName: users.name, serviceName: quotes.serviceName })
    .from(payments)
    .innerJoin(cases, eq(cases.id, payments.caseId))
    .innerJoin(quotes, eq(quotes.id, payments.quoteId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(staffCaseScope(actor))
    .orderBy(desc(payments.createdAt))
    .limit(300);
}

export { adminCaseLink };
