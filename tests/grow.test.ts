import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  GROW_PRODUCTION_URL,
  GROW_SANDBOX_URL,
  growBaseUrl,
  growCallbackToken,
  growText,
  isValidGrowFullName,
  normalizeIsraeliMobile,
  parseGrowCallback,
  verifyGrowCallbackToken,
} from "@/lib/payments/grow";
import { activePaymentProvider, connectGrow, disconnectGrow, getGrowConfig, getPaymentProviderStatus } from "@/lib/services/payment-settings";
import { createCheckout, growNotifyUrl, growReturnUrl, handleGrowCallback } from "@/lib/services/payments";
import { approveQuote } from "@/lib/services/quotes";
import { getSettings } from "@/lib/services/settings";
import { getCaseRow } from "@/lib/services/cases";
import { caseWithSentQuote, expectCode, getAdmin, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
const payer = { fullName: "Noam Israeli", phone: "+972 50-123-4567", acceptTerms: true };

/** A fake Grow API: records every call and answers like the real one. */
type Call = { method: string; url: string; fields: Record<string, string> };
let calls: Call[];
let txInfo: Record<string, unknown>;
let failNext: string | null;
function fakeGrow() {
  calls = [];
  failNext = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = url.split("/").pop()!;
      const fields: Record<string, string> = {};
      for (const [k, v] of (init!.body as FormData).entries()) fields[k] = String(v);
      calls.push({ method, url, fields });
      if (failNext === method) return Response.json({ status: 0, err: { id: 1, message: "שגיאה" }, data: "" });
      if (method === "createPaymentProcess") return Response.json({ status: 1, err: "", data: { url: "https://sandbox.meshulam.co.il/s/abc123", processId: 5550001, processToken: "ptok123" } });
      if (method === "getTransactionInfo") return Response.json({ status: 1, err: "", data: txInfo });
      if (method === "approveTransaction") return Response.json({ status: 1, err: "", data: "" });
      return new Response("not found", { status: 404 });
    }),
  );
}

/** A case awaiting payment of 1,180.00 ILS (1,000 + 18% VAT). */
async function awaitingPayment(customer?: s.User) {
  const c = customer ?? (await makeUser(db, "customer"));
  const { c: kase, quoteId } = await caseWithSentQuote(db, c);
  await approveQuote(db, c, quoteId, null);
  return { customer: c, caseId: kase.id, quoteId };
}

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});
beforeEach(() => fakeGrow());
afterEach(() => vi.unstubAllGlobals());

describe("Grow helpers", () => {
  it("strips characters Grow rejects", () => {
    expect(growText("CASE-2026-0001 — Visa (B1/B2) & more!")).toBe("CASE 2026 0001 Visa B1 B2 more");
    expect(growText("חידוש אשרה 2026")).toBe("חידוש אשרה 2026");
  });

  it("accepts Israeli mobile numbers in common formats only", () => {
    for (const ok of ["0501234567", "050-123-4567", "+972 50 123 4567", "972501234567", " 054 1234567 "]) expect(normalizeIsraeliMobile(ok), ok).toMatch(/^05\d{8}$/);
    expect(normalizeIsraeliMobile("+972501234567")).toBe("0501234567");
    for (const bad of ["", null, "031234567", "05012345", "050123456789", "+1 202 555 0100", "abc"]) expect(normalizeIsraeliMobile(bad as string | null)).toBeNull();
  });

  it("requires a full name of at least two words", () => {
    expect(isValidGrowFullName("Noam Israeli")).toBe(true);
    expect(isValidGrowFullName("נועם ישראלי")).toBe(true);
    for (const bad of ["Noam", "  Noam  ", "", null, "Noam -", "!!! ???"]) expect(isValidGrowFullName(bad as string | null), String(bad)).toBe(false);
  });

  it("reads server updates sent flat, nested (data[...]) or as JSON", () => {
    expect(parseGrowCallback("transactionId=1&transactionToken=abcd1234&sum=10", "application/x-www-form-urlencoded")).toMatchObject({ transactionId: "1", sum: "10" });
    const nested = parseGrowCallback("status=1&data%5BtransactionId%5D=2&data%5Bsum%5D=11&data%5BcustomFields%5D%5BcField1%5D=xyz", "application/x-www-form-urlencoded");
    expect(nested).toMatchObject({ transactionId: "2", sum: "11", customFields: { cField1: "xyz" } });
    expect(parseGrowCallback(JSON.stringify({ status: "1", data: { transactionId: "3" } }), "application/json")).toMatchObject({ transactionId: "3" });
    expect(parseGrowCallback("{not json", "application/json")).toEqual({});
  });

  it("callback tokens are tied to one payment", () => {
    const a = "11111111-1111-1111-1111-111111111111";
    const b = "22222222-2222-2222-2222-222222222222";
    expect(verifyGrowCallbackToken(a, growCallbackToken(a))).toBe(true);
    expect(verifyGrowCallbackToken(b, growCallbackToken(a))).toBe(false);
    expect(verifyGrowCallbackToken(a, "forged")).toBe(false);
  });

  it("uses the sandbox or production URL, or an override", () => {
    expect(growBaseUrl({ userId: "u", pageCode: "p", sandbox: true })).toBe(GROW_SANDBOX_URL);
    expect(growBaseUrl({ userId: "u", pageCode: "p", sandbox: false })).toBe(GROW_PRODUCTION_URL);
    expect(GROW_PRODUCTION_URL).toBe("https://secure.meshulam.co.il/api/light/server/1.0");
    expect(growBaseUrl({ userId: "u", pageCode: "p", sandbox: false, baseUrl: "https://example.test/api/" })).toBe("https://example.test/api");
  });
});

describe("connecting Grow", () => {
  afterEach(async () => disconnectGrow(db, admin));

  it("only admins can connect or disconnect", async () => {
    for (const role of ["case_manager", "staff", "finance", "customer"] as const) {
      const u = await makeUser(db, role);
      await expectCode(connectGrow(db, u, { userId: "abcd1234", pageCode: "page1234", sandbox: true }), "forbidden");
      await expectCode(disconnectGrow(db, u), "forbidden");
    }
  });

  it("rejects identifiers that aren't letters and digits", async () => {
    for (const bad of [{ userId: "ab", pageCode: "page1234" }, { userId: "abc 1234", pageCode: "page1234" }, { userId: "abcd1234", pageCode: "page-1234" }]) {
      await expectCode(connectGrow(db, admin, { ...bad, sandbox: true }), "validation");
    }
    await expectCode(connectGrow(db, admin, { userId: "abcd1234", pageCode: "page1234", apiKey: "bad key", sandbox: true }), "validation");
  });

  it("switches checkout to Grow, stores the identifiers encrypted and shows only hints", async () => {
    expect(await activePaymentProvider(db)).toBe("mock");
    await connectGrow(db, admin, { userId: " 4ec1d595ae764243 ", pageCode: "0b7a16e03b25", apiKey: "", sandbox: true });
    expect(await activePaymentProvider(db)).toBe("grow");
    expect(await getGrowConfig(db)).toMatchObject({ userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", apiKey: null, sandbox: true, source: "settings" });

    const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "payments.grow"));
    expect(JSON.stringify(row!.value)).not.toContain("4ec1d595ae764243");
    expect(JSON.stringify(row!.value)).not.toContain("0b7a16e03b25");
    // Not part of the general settings sent to the settings page.
    expect(Object.keys(await getSettings(db))).not.toContain("payments.grow");
    // Not in the audit log either.
    const logs = await db.select().from(s.auditLogs).where(eq(s.auditLogs.action, "payments.grow_connect"));
    expect(JSON.stringify(logs)).not.toContain("4ec1d595ae764243");

    const st = await getPaymentProviderStatus(db);
    expect(st).toMatchObject({ active: "grow", grow: { connected: true, source: "settings", sandbox: true, userIdHint: "••••4243", pageCodeHint: "••••3b25" } });
    expect(JSON.stringify(st)).not.toContain("4ec1d595ae764243");

    await disconnectGrow(db, admin);
    expect(await activePaymentProvider(db)).toBe("mock");
    expect((await getPaymentProviderStatus(db)).grow.connected).toBe(false);
  });

  it("can be configured with GROW_* environment variables instead", async () => {
    const saved = { growUserId: env.growUserId, growPageCode: env.growPageCode, growSandbox: env.growSandbox };
    Object.assign(env, { growUserId: "envuser1", growPageCode: "envpage1", growSandbox: false });
    try {
      expect(await getGrowConfig(db)).toMatchObject({ userId: "envuser1", pageCode: "envpage1", sandbox: false, source: "env" });
      expect((await getPaymentProviderStatus(db)).grow).toMatchObject({ connected: true, source: "env", sandbox: false });
      // A connection saved by an admin takes precedence.
      await connectGrow(db, admin, { userId: "dbuser01", pageCode: "dbpage01", sandbox: true });
      expect((await getGrowConfig(db))!.userId).toBe("dbuser01");
    } finally {
      Object.assign(env, saved);
    }
  });
});

describe("paying with Grow", () => {
  beforeAll(async () => connectGrow(db, admin, { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: true }));

  it("opens Grow's payment page with the right amount, details and return addresses", async () => {
    const { customer, quoteId, caseId } = await awaitingPayment();
    const r = await createCheckout(db, customer, quoteId, payer);
    expect(r.url).toBe("https://sandbox.meshulam.co.il/s/abc123");
    const call = calls.find((c) => c.method === "createPaymentProcess")!;
    expect(call.url).toBe(`${GROW_SANDBOX_URL}/createPaymentProcess`);
    expect(call.fields).toMatchObject({
      pageCode: "0b7a16e03b25",
      userId: "4ec1d595ae764243",
      sum: "1180.00",
      chargeType: "1",
      "pageField[fullName]": "Noam Israeli",
      "pageField[phone]": "0501234567",
      "pageField[email]": customer.email,
      successUrl: growReturnUrl(r.paymentId, "success"),
      cancelUrl: growReturnUrl(r.paymentId, "cancelled"),
      notifyUrl: growNotifyUrl(r.paymentId),
      cField1: r.paymentId.replace(/-/g, ""),
    });
    // Grow rejects special characters, so no query strings and a clean description.
    for (const k of ["successUrl", "cancelUrl", "notifyUrl"]) expect(call.fields[k]).not.toMatch(/[?&=]/);
    expect(call.fields.description).toMatch(/^CASE \d{4} \d{4} Service$/);
    expect(call.fields.apiKey).toBeUndefined();

    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, r.paymentId));
    expect(p).toMatchObject({ provider: "grow", status: "pending", amountCents: 118000, currency: "ILS", providerSessionId: "5550001", caseId });
    // The phone is kept for next time.
    expect((await db.select().from(s.users).where(eq(s.users.id, customer.id)))[0]!.phone).toBe("0501234567");
  });

  it("requires accepted terms, a full name and a valid mobile number", async () => {
    const { customer, quoteId } = await awaitingPayment();
    await expectCode(createCheckout(db, customer, quoteId), "terms_required");
    await expectCode(createCheckout(db, customer, quoteId, { ...payer, acceptTerms: false }), "terms_required");
    await expectCode(createCheckout(db, customer, quoteId, { ...payer, fullName: "Noam" }), "payer_name_invalid");
    await expectCode(createCheckout(db, customer, quoteId, { ...payer, phone: "03-1234567" }), "payer_phone_invalid");
    expect(calls).toHaveLength(0);
    expect(await db.select().from(s.payments).where(eq(s.payments.quoteId, quoteId))).toHaveLength(0);
  });

  it("only takes shekels", async () => {
    const { customer, quoteId } = await awaitingPayment();
    await db.update(s.quotes).set({ currency: "USD" }).where(eq(s.quotes.id, quoteId));
    await expectCode(createCheckout(db, customer, quoteId, payer), "currency_not_supported");
  });

  it("if Grow refuses, the customer gets a clear error and no pending payment is left", async () => {
    const { customer, quoteId } = await awaitingPayment();
    failNext = "createPaymentProcess";
    await expectCode(createCheckout(db, customer, quoteId, payer), "payment_provider_error");
    const rows = await db.select().from(s.payments).where(eq(s.payments.quoteId, quoteId));
    expect(rows.map((p) => [p.status, p.failureReason])).toEqual([["cancelled", "provider_error"]]);
  });

  it("the usual checks still apply: own quote only, approved quote only, not paid twice", async () => {
    const { quoteId } = await awaitingPayment();
    await expectCode(createCheckout(db, await makeUser(db, "customer"), quoteId, payer), "not_found");
    await expectCode(createCheckout(db, admin, quoteId, payer), "forbidden");
  });

  it("sends the apiKey when one is configured", async () => {
    await connectGrow(db, admin, { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", apiKey: "57ce86548429", sandbox: true });
    try {
      const { customer, quoteId } = await awaitingPayment();
      await createCheckout(db, customer, quoteId, payer);
      expect(calls[0]!.fields.apiKey).toBe("57ce86548429");
    } finally {
      await connectGrow(db, admin, { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: true });
    }
  });

  it("live mode uses Grow's production URL", async () => {
    await connectGrow(db, admin, { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: false });
    try {
      const { customer, quoteId } = await awaitingPayment();
      await createCheckout(db, customer, quoteId, payer);
      expect(calls[0]!.url).toBe(`${GROW_PRODUCTION_URL}/createPaymentProcess`);
    } finally {
      await connectGrow(db, admin, { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: true });
    }
  });
});

describe("Grow server updates", () => {
  beforeAll(async () => connectGrow(db, admin, { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: true }));

  async function startPayment() {
    const a = await awaitingPayment();
    const { paymentId } = await createCheckout(db, a.customer, a.quoteId, payer);
    calls = [];
    return { ...a, paymentId, token: growCallbackToken(paymentId) };
  }
  const update = (paymentId: string, over: Record<string, unknown> = {}) => ({
    transactionId: "145111110",
    transactionToken: "c68d98D4c3f19b30hgy7362e9g5g5g5862",
    sum: "1180",
    statusCode: "2",
    asmachta: "0289199",
    customFields: { cField1: paymentId.replace(/-/g, "") },
    ...over,
  });
  const paidInfo = (over: Record<string, unknown> = {}) => ({
    transactionId: "145111110",
    transactionToken: "c68d98D4c3f19b30hgy7362e9g5g5g5862",
    statusCode: "2",
    status: "שולם",
    sum: "1180",
    asmachta: "0289199",
    transactionTypeId: "1",
    paymentType: "2",
    processId: "5550001",
    processToken: "ptok123",
    ...over,
  });

  it("a paid update is confirmed with Grow, activates the case and is acknowledged", async () => {
    const { paymentId, token, caseId } = await startPayment();
    txInfo = paidInfo();
    expect(await handleGrowCallback(db, paymentId, token, update(paymentId))).toEqual({ result: "applied" });
    // Confirmed with Grow before counting, then acknowledged.
    expect(calls.map((c) => c.method)).toEqual(["getTransactionInfo", "approveTransaction"]);
    expect(calls[0]!.fields).toMatchObject({ pageCode: "0b7a16e03b25", transactionId: "145111110", transactionToken: "c68d98D4c3f19b30hgy7362e9g5g5g5862" });
    expect(calls[1]!.fields).toMatchObject({ pageCode: "0b7a16e03b25", transactionId: "145111110", sum: "1180", asmachta: "0289199", processId: "5550001" });
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
    expect(p).toMatchObject({ status: "succeeded", providerPaymentId: "145111110" });
    expect((await getCaseRow(db, caseId)).status).toBe("active");
  });

  it("a repeated update is a no-op but is still acknowledged (Grow resends until it is)", async () => {
    const { paymentId, token } = await startPayment();
    txInfo = paidInfo({ transactionId: "145111111" });
    await handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111111" }));
    calls = [];
    expect(await handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111111" }))).toEqual({ result: "duplicate" });
    expect(calls.map((c) => c.method)).toEqual(["getTransactionInfo", "approveTransaction"]);
  });

  it("trusts Grow's answer, not the update's body: a forged 'paid' for an unpaid transaction does nothing", async () => {
    const { paymentId, token, caseId } = await startPayment();
    txInfo = paidInfo({ transactionId: "145111112", statusCode: "1", status: "ממתין" });
    expect(await handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111112", statusCode: "2" }))).toEqual({ result: "ignored" });
    expect(calls.map((c) => c.method)).toEqual(["getTransactionInfo"]); // nothing to acknowledge
    expect((await db.select().from(s.payments).where(eq(s.payments.id, paymentId)))[0]!.status).toBe("pending");
    expect((await getCaseRow(db, caseId)).status).toBe("awaiting_payment");
  });

  it("an amount that doesn't match the quote is rejected", async () => {
    const { paymentId, token, caseId } = await startPayment();
    txInfo = paidInfo({ transactionId: "145111113", sum: "1.00" });
    expect(await handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111113" }))).toEqual({ result: "rejected" });
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
    expect(p).toMatchObject({ status: "failed", failureReason: "amount_mismatch" });
    expect((await getCaseRow(db, caseId)).status).toBe("awaiting_payment");
  });

  it("refuses updates without the right token, for another payment, or with bad ids", async () => {
    const { paymentId, token } = await startPayment();
    const other = await startPayment();
    txInfo = paidInfo({ transactionId: "145111114" });
    await expectCode(handleGrowCallback(db, paymentId, "forged", update(paymentId)), "forbidden");
    await expectCode(handleGrowCallback(db, paymentId, other.token, update(paymentId)), "forbidden");
    await expectCode(handleGrowCallback(db, "not-a-uuid", token, update(paymentId)), "forbidden");
    await expectCode(handleGrowCallback(db, paymentId, token, update(paymentId, { customFields: { cField1: other.paymentId.replace(/-/g, "") } })), "forbidden");
    await expectCode(handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "12; drop" })), "validation");
    await expectCode(handleGrowCallback(db, paymentId, token, update(paymentId, { transactionToken: "" })), "validation");
    expect(calls).toHaveLength(0); // Grow isn't even asked
    expect((await db.select().from(s.payments).where(eq(s.payments.id, paymentId)))[0]!.status).toBe("pending");
  });

  it("refuses updates for payments that aren't Grow payments", async () => {
    const [mockPayment] = await db
      .insert(s.payments)
      .values({ quoteId: (await awaitingPayment()).quoteId, caseId: (await awaitingPayment()).caseId, provider: "mock", amountCents: 1, currency: "ILS", status: "pending" })
      .returning();
    await expectCode(handleGrowCallback(db, mockPayment!.id, growCallbackToken(mockPayment!.id), update(mockPayment!.id)), "not_found");
  });

  it("if acknowledging fails, the payment still counts", async () => {
    const { paymentId, token } = await startPayment();
    txInfo = paidInfo({ transactionId: "145111115" });
    failNext = "approveTransaction";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111115" }))).toEqual({ result: "applied" });
    spy.mockRestore();
    expect((await db.select().from(s.payments).where(eq(s.payments.id, paymentId)))[0]!.status).toBe("succeeded");
  });

  it("if Grow can't be reached to confirm, nothing changes and the update can be retried", async () => {
    const { paymentId, token } = await startPayment();
    failNext = "getTransactionInfo";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expectCode(handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111116" })), "payment_provider_error");
    spy.mockRestore();
    expect((await db.select().from(s.payments).where(eq(s.payments.id, paymentId)))[0]!.status).toBe("pending");
    // Grow retries; now it works.
    failNext = null;
    txInfo = paidInfo({ transactionId: "145111116" });
    expect(await handleGrowCallback(db, paymentId, token, update(paymentId, { transactionId: "145111116" }))).toEqual({ result: "applied" });
  });
});
