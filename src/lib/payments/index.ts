import { env } from "../env";
import { hmac, safeEqual } from "../crypto";
import { AppError } from "../errors";

export type CheckoutInput = {
  paymentId: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
};

export type NormalizedPaymentEvent = {
  provider: string;
  eventId: string;
  kind: "succeeded" | "failed" | "cancelled" | "ignored";
  paymentId: string | null;
  providerPaymentId: string | null;
  amountCents: number | null;
  currency: string | null;
  failureReason?: string | null;
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  name: string;
  createCheckout(input: CheckoutInput): Promise<{ sessionId: string; url: string }>;
  parseWebhook(rawBody: string, headers: Headers): Promise<NormalizedPaymentEvent>;
}

/** Local hosted-checkout simulator. Its "webhooks" are HMAC-signed and go through the same idempotent handler. */
export const mockProvider: PaymentProvider = {
  name: "mock",
  async createCheckout(input) {
    return { sessionId: `mock_cs_${input.paymentId}`, url: `/pay/mock/${input.paymentId}` };
  },
  async parseWebhook(rawBody, headers) {
    const sig = headers.get("x-mock-signature") ?? "";
    if (!safeEqual(hmac(rawBody, env.paymentWebhookSecret), sig)) throw new AppError("forbidden", "Bad signature");
    const evt = JSON.parse(rawBody) as {
      id: string;
      type: "payment.succeeded" | "payment.failed" | "payment.cancelled";
      data: { paymentId: string; providerPaymentId?: string; amountCents: number; currency: string; reason?: string };
    };
    return {
      provider: "mock",
      eventId: evt.id,
      kind: evt.type === "payment.succeeded" ? "succeeded" : evt.type === "payment.failed" ? "failed" : "cancelled",
      paymentId: evt.data.paymentId,
      providerPaymentId: evt.data.providerPaymentId ?? null,
      amountCents: evt.data.amountCents,
      currency: evt.data.currency,
      failureReason: evt.data.reason ?? null,
      raw: evt as unknown as Record<string, unknown>,
    };
  },
};

export function signMockEvent(body: string) {
  return hmac(body, env.paymentWebhookSecret);
}

async function stripeClient() {
  const { default: Stripe } = await import("stripe");
  return new Stripe(env.stripeSecretKey);
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckout(input) {
    const stripe = await stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: input.paymentId,
      metadata: { paymentId: input.paymentId },
      payment_intent_data: { metadata: { paymentId: input.paymentId } },
      customer_email: input.customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountCents, product_data: { name: input.description } },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    return { sessionId: session.id, url: session.url! };
  },
  async parseWebhook(rawBody, headers) {
    const stripe = await stripeClient();
    const sig = headers.get("stripe-signature") ?? "";
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, env.stripeWebhookSecret);
    } catch {
      throw new AppError("forbidden", "Bad signature");
    }
    const obj = event.data.object as unknown as Record<string, unknown> & { metadata?: Record<string, string> };
    const base = {
      provider: "stripe",
      eventId: event.id,
      paymentId: obj.metadata?.paymentId ?? (obj.client_reference_id as string) ?? null,
      providerPaymentId: (obj.payment_intent as string) ?? null,
      amountCents: (obj.amount_total as number) ?? null,
      currency: ((obj.currency as string) ?? "").toUpperCase() || null,
      raw: event as unknown as Record<string, unknown>,
    };
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return { ...base, kind: obj.payment_status === "paid" ? "succeeded" : "ignored" };
      case "checkout.session.async_payment_failed":
        return { ...base, kind: "failed", failureReason: "async_payment_failed" };
      case "checkout.session.expired":
        return { ...base, kind: "cancelled", failureReason: "expired" };
      default:
        return { ...base, kind: "ignored" };
    }
  },
};

/** Mock or Stripe. Grow is handled separately (services/payments.ts), since its identifiers can live in the database. */
export function paymentProvider(name?: string): PaymentProvider {
  const n = name ?? env.paymentProvider;
  return n === "stripe" ? stripeProvider : mockProvider;
}
