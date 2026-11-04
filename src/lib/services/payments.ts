import { and, desc, eq } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { cases, customers, paymentEvents, payments, quotes, users, type User } from "../db/schema";
import { AppError } from "../errors";
import { env } from "../env";
import { paymentProvider, mockProvider, signMockEvent, type NormalizedPaymentEvent } from "../payments";
import {
  GROW_PAID,
  growApproveTransaction,
  growCallbackToken,
  growCreatePaymentProcess,
  growGetTransactionInfo,
  isValidGrowFullName,
  normalizeIsraeliMobile,
  verifyGrowCallbackToken,
} from "../payments/grow";
import { activePaymentProvider, getGrowConfig } from "./payment-settings";
import { applyStatus, adminCaseLink, caseWithAccess, portalCaseLink, staffCaseScope } from "./cases";
import { addEvent } from "./events";
import { audit } from "./audit";
import { notify, staffRecipients } from "./notifications";
import { customerUserIdOf } from "./cases";

export type PayerDetails = { fullName: string; phone: string; acceptTerms: boolean };

/**
 * Starts a hosted checkout for an approved quote (one payment per quote in the MVP).
 * Grow needs the payer's full name and Israeli mobile number up front, and its production review requires
 * the customer to accept the terms on the payment step, so `payer` is mandatory when Grow is connected.
 */
export async function createCheckout(db: Database, actor: User, quoteId: string, payer?: PayerDetails) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) throw new AppError("not_found");
  const { c, access } = await caseWithAccess(db, actor, q.caseId);
  if (!access.isClient) throw new AppError("forbidden");
  if (q.status !== "approved" || c.status !== "awaiting_payment") throw new AppError("payment_not_allowed");
  const [paid] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.quoteId, q.id), eq(payments.status, "succeeded")));
  if (paid) throw new AppError("already_paid");

  const providerName = await activePaymentProvider(db);
  if (providerName === "grow") return createGrowCheckout(db, actor, q, c, payer);

  const provider = paymentProvider(providerName);
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

/** Where Grow sends the customer back. A plain path, because Grow rejects special characters such as ? and &. */
export const growReturnUrl = (paymentId: string, result: "success" | "cancelled") => `${env.appUrl}/pay/return/${paymentId}/${result}`;
export const growNotifyUrl = (paymentId: string) => `${env.appUrl}/api/webhooks/grow/${paymentId}/${growCallbackToken(paymentId)}`;

async function createGrowCheckout(db: Database, actor: User, q: typeof quotes.$inferSelect, c: { id: string; number: string }, payer?: PayerDetails) {
  const cfg = await getGrowConfig(db);
  if (!cfg) throw new AppError("payment_not_allowed");
  if (q.currency.toUpperCase() !== "ILS") throw new AppError("currency_not_supported");
  if (!payer?.acceptTerms) throw new AppError("terms_required");
  if (!isValidGrowFullName(payer.fullName)) throw new AppError("payer_name_invalid");
  const phone = normalizeIsraeliMobile(payer.phone);
  if (!phone) throw new AppError("payer_phone_invalid");

  const [p] = await db
    .insert(payments)
    .values({ quoteId: q.id, caseId: c.id, provider: "grow", amountCents: q.totalCents, currency: "ILS", status: "pending", createdById: actor.id })
    .returning();
  let session: { url: string; processId: string };
  try {
    session = await growCreatePaymentProcess(cfg, {
      sum: q.totalCents / 100,
      description: `${c.number} ${q.serviceName}`,
      fullName: payer.fullName,
      phone,
      email: actor.email,
      successUrl: growReturnUrl(p!.id, "success"),
      cancelUrl: growReturnUrl(p!.id, "cancelled"),
      notifyUrl: growNotifyUrl(p!.id),
      paymentId: p!.id,
    });
  } catch (err) {
    // Don't leave a pending payment behind when Grow refused to open the page.
    await db.update(payments).set({ status: "cancelled", failureReason: "provider_error", updatedAt: new Date() }).where(eq(payments.id, p!.id));
    throw err;
  }
  // Keep the phone for next time if the profile has none.
  if (!actor.phone) await db.update(users).set({ phone }).where(eq(users.id, actor.id));
  await db.update(payments).set({ providerSessionId: session.processId || null, updatedAt: new Date() }).where(eq(payments.id, p!.id));
  await audit(db, { actorId: actor.id, action: "payment.checkout", entityType: "payment", entityId: p!.id, details: { provider: "grow", sandbox: cfg.sandbox, amountCents: q.totalCents } });
  return { paymentId: p!.id, url: session.url };
}

/**
 * Grow server update. Grow doesn't sign these, so: the URL must carry the HMAC token for this payment, and
 * the transaction is then re-read from Grow (getTransactionInfo) — only Grow's own answer moves the payment.
 * Successful updates are acknowledged with approveTransaction, as Grow requires.
 */
export async function handleGrowCallback(db: Database, paymentId: string, token: string, fields: Record<string, unknown>) {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId) || !verifyGrowCallbackToken(paymentId, token)) throw new AppError("forbidden");
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p || p.provider !== "grow") throw new AppError("not_found");
  const transactionId = String(fields.transactionId ?? "");
  const transactionToken = String(fields.transactionToken ?? "");
  if (!/^\d{1,20}$/.test(transactionId) || !/^[A-Za-z0-9]{8,128}$/.test(transactionToken)) throw new AppError("validation");
  const custom = fields.customFields as Record<string, string> | undefined;
  if (custom?.cField1 && custom.cField1 !== paymentId.replace(/-/g, "")) throw new AppError("forbidden");
  const cfg = await getGrowConfig(db);
  if (!cfg) throw new AppError("payment_provider_error", "Grow is not connected");

  const info = await growGetTransactionInfo(cfg, { transactionId, transactionToken });
  const paid = String(info.statusCode) === GROW_PAID;
  const sum = Number(String(info.sum).replace(/,/g, ""));
  const evt: NormalizedPaymentEvent = {
    provider: "grow",
    eventId: `grow_tx_${info.transactionId ?? transactionId}`,
    kind: paid ? "succeeded" : "ignored",
    paymentId: p.id,
    providerPaymentId: String(info.transactionId ?? transactionId),
    amountCents: Number.isFinite(sum) ? Math.round(sum * 100) : null,
    currency: "ILS",
    raw: { callback: fields, transaction: info } as Record<string, unknown>,
  };
  const res = await applyPaymentEvent(db, evt);
  if (paid) {
    try {
      await growApproveTransaction(cfg, { ...fields, ...info });
    } catch (err) {
      // Not fatal: the payment stands, and Grow resends the update (up to 5 times) until it's acknowledged.
      console.error("[grow] approveTransaction failed", err);
    }
  }
  return res;
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
