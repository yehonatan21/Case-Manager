/**
 * Grow (formerly Meshulam) "Light API" client: hosted payment page (createPaymentProcess),
 * transaction lookup (getTransactionInfo) and the acknowledgement Grow requires (approveTransaction).
 * Docs: https://developers.grow.business/reference/create-payment-process
 *
 * Grow's server-to-server callback is NOT signed. We therefore never trust its body: the callback URL
 * carries an HMAC of our payment id, and the transaction is re-read from Grow's API before it counts.
 */
import { hmac, safeEqual } from "../crypto";
import { AppError } from "../errors";

export const GROW_SANDBOX_URL = "https://sandbox.meshulam.co.il/api/light/server/1.0";
export const GROW_PRODUCTION_URL = "https://secure.meshulam.co.il/api/light/server/1.0";

export type GrowConfig = {
  userId: string;
  pageCode: string;
  /** Only for companies that manage several businesses. */
  apiKey?: string | null;
  sandbox: boolean;
  /** Overrides the API base URL (tests, or a URL Grow gives you). */
  baseUrl?: string | null;
};

export type GrowTransaction = {
  transactionId: string;
  transactionToken: string;
  statusCode: string;
  sum: string;
  asmachta?: string;
  processId?: string;
  processToken?: string;
  customFields?: Record<string, string>;
  [k: string]: unknown;
};

/** Grow status code for a completed ("שולם") payment. */
export const GROW_PAID = "2";

export const growBaseUrl = (cfg: GrowConfig) => (cfg.baseUrl || (cfg.sandbox ? GROW_SANDBOX_URL : GROW_PRODUCTION_URL)).replace(/\/$/, "");

/** Grow rejects "special characters" in text fields: keep letters, digits and spaces. */
export function growText(s: string, max = 120): string {
  return s
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Israeli mobile number in the 05XXXXXXXX form Grow expects, or null. Accepts +972 / spaces / dashes. */
export function normalizeIsraeliMobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return /^05\d{8}$/.test(digits) ? digits : null;
}

/** Grow requires a full name of at least two words. */
export function isValidGrowFullName(name: string | null | undefined): boolean {
  return growText(name ?? "").split(" ").filter((w) => w.length > 0).length >= 2;
}

/** Proof, embedded in the callback URL, that a callback is about this payment. */
export const growCallbackToken = (paymentId: string) => hmac(`grow-callback:${paymentId}`);
export const verifyGrowCallbackToken = (paymentId: string, token: string) => safeEqual(growCallbackToken(paymentId), token);

type GrowResponse<T> = { status: number | string; err: string | { id?: number; message?: string } | ""; data: T };

async function call<T>(cfg: GrowConfig, method: string, fields: Record<string, string | number | null | undefined>): Promise<T> {
  const form = new FormData();
  form.set("pageCode", cfg.pageCode);
  if (cfg.apiKey) form.set("apiKey", cfg.apiKey);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") form.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(`${growBaseUrl(cfg)}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    console.error(`[grow] ${method} request failed`, err);
    throw new AppError("payment_provider_error");
  }
  let json: GrowResponse<T> | null = null;
  try {
    json = (await res.json()) as GrowResponse<T>;
  } catch {
    // fall through
  }
  if (!res.ok || !json || String(json.status) !== "1") {
    const message = json && typeof json.err === "object" ? json.err.message : json?.err;
    console.error(`[grow] ${method} rejected`, res.status, message ?? "(no body)");
    throw new AppError("payment_provider_error", typeof message === "string" && message ? message : undefined);
  }
  return json.data;
}

export async function growCreatePaymentProcess(
  cfg: GrowConfig,
  input: { sum: number; description: string; fullName: string; phone: string; email?: string | null; successUrl: string; cancelUrl: string; notifyUrl: string; paymentId: string },
): Promise<{ url: string; processId: string; processToken: string }> {
  const data = await call<{ url?: string; processId?: string | number; processToken?: string }>(cfg, "createPaymentProcess", {
    userId: cfg.userId,
    sum: input.sum.toFixed(2),
    chargeType: 1,
    description: growText(input.description, 200) || "Payment",
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    notifyUrl: input.notifyUrl,
    "pageField[fullName]": growText(input.fullName, 100),
    "pageField[phone]": input.phone,
    "pageField[email]": input.email ?? undefined,
    cField1: input.paymentId.replace(/-/g, ""), // no special characters allowed
  });
  if (!data?.url) throw new AppError("payment_provider_error", "No payment page URL");
  return { url: data.url, processId: String(data.processId ?? ""), processToken: String(data.processToken ?? "") };
}

export async function growGetTransactionInfo(cfg: GrowConfig, ids: { transactionId: string; transactionToken: string }): Promise<GrowTransaction> {
  return call<GrowTransaction>(cfg, "getTransactionInfo", { transactionId: ids.transactionId, transactionToken: ids.transactionToken });
}

/** Acknowledges a server update. It doesn't change the payment; Grow resends updates that aren't acknowledged. */
export async function growApproveTransaction(cfg: GrowConfig, tx: Record<string, unknown>): Promise<void> {
  const keys = [
    "transactionId", "transactionToken", "transactionTypeId", "paymentType", "sum", "firstPaymentSum", "periodicalPaymentSum",
    "paymentsNum", "allPaymentsNum", "paymentDate", "asmachta", "description", "fullName", "payerPhone", "payerEmail",
    "cardSuffix", "cardType", "cardTypeCode", "cardBrand", "cardBrandCode", "cardExp", "processId", "processToken",
    "paymentLinkProcessId", "paymentLinkProcessToken",
  ];
  const fields: Record<string, string> = {};
  for (const k of keys) if (tx[k] !== undefined && tx[k] !== null && typeof tx[k] !== "object") fields[k] = String(tx[k]);
  await call(cfg, "approveTransaction", fields);
}

/**
 * Reads a Grow server update. Grow posts form fields "the same way as createPaymentProcess", which in
 * practice arrive either flat (transactionId=…) or nested (data[transactionId]=…); JSON is accepted too.
 */
export function parseGrowCallback(rawBody: string, contentType: string | null): Record<string, unknown> {
  const flat: Record<string, string> = {};
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/json") || rawBody.trim().startsWith("{")) {
    try {
      const j = JSON.parse(rawBody) as { data?: Record<string, unknown> } & Record<string, unknown>;
      const d = (j.data && typeof j.data === "object" ? j.data : j) as Record<string, unknown>;
      return d;
    } catch {
      return {};
    }
  }
  for (const [k, v] of new URLSearchParams(rawBody)) flat[k] = v;
  const out: Record<string, unknown> = {};
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) {
    const m = k.match(/^data\[([^\]]+)\](?:\[([^\]]+)\])?$/);
    if (m) {
      if (m[2]) custom[m[2]] = v;
      else out[m[1]!] = v;
    } else if (!(k in out)) out[k] = v;
  }
  if (Object.keys(custom).length) out.customFields = custom;
  return out;
}

/** Multipart callbacks: turn FormData into the same shape as parseGrowCallback. */
export function growCallbackFromForm(form: FormData): Record<string, unknown> {
  const params = new URLSearchParams();
  for (const [k, v] of form.entries()) if (typeof v === "string") params.append(k, v);
  return parseGrowCallback(params.toString(), "application/x-www-form-urlencoded");
}
