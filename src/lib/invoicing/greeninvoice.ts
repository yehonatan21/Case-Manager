/**
 * Green Invoice / Morning (חשבונית ירוקה) — https://www.greeninvoice.co.il/api-docs
 * Auth: POST /account/token {id, secret} → a JWT. Documents: POST /documents.
 */
import { InvoiceError, type InvoiceConfig, type InvoiceProvider, type InvoiceRequest, type IssuedInvoice } from "./index";

export const GREEN_INVOICE_URL = "https://api.greeninvoice.co.il/api/v1";
export const GREEN_INVOICE_SANDBOX_URL = "https://sandbox.d.greeninvoice.co.il/api/v1";
/** Hosts the document PDFs come from (plus the API host itself). */
const PDF_HOSTS = ["greeninvoice.co.il", "morning.co"];
/** Green Invoice payment types: 1 cash, 2 cheque, 3 credit card, 4 bank transfer, 10 payment app (Bit, PayBox…), 11 other. */
const PAYMENT_TYPE = { credit_card: 3, bank_transfer: 4, bit: 10, other: 11 } as const;

const tokenCache = new Map<string, { token: string; until: number }>();

export function createGreenInvoiceProvider(cfg: InvoiceConfig): InvoiceProvider {
  const base = (cfg.apiUrl || (cfg.sandbox ? GREEN_INVOICE_SANDBOX_URL : GREEN_INVOICE_URL)).replace(/\/+$/, "");
  const cacheKey = `${base}|${cfg.apiKeyId}`;

  async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (init.auth !== false) headers.Authorization = `Bearer ${await token()}`;
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new InvoiceError(`Green Invoice unreachable: ${(e as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as T & { errorCode?: number; errorMessage?: string };
    if (!res.ok || body.errorCode) {
      const msg = `${body.errorMessage ?? `HTTP ${res.status}`}${body.errorCode ? ` (${body.errorCode})` : ""}`.slice(0, 300);
      // Rate limits and outages are worth retrying; refusals (bad data, bad keys) are not.
      throw new InvoiceError(msg, res.status >= 500 || res.status === 429);
    }
    return body;
  }

  async function token(): Promise<string> {
    const c = tokenCache.get(cacheKey);
    if (c && c.until > Date.now()) return c.token;
    const r = await request<{ token: string; expires?: number }>("/account/token", { method: "POST", auth: false, body: JSON.stringify({ id: cfg.apiKeyId, secret: cfg.apiSecret }) });
    if (!r.token) throw new InvoiceError("Green Invoice returned no token", false);
    // Tokens last about an hour; `expires` is a Unix time in seconds.
    const until = r.expires ? r.expires * 1000 - 60_000 : Date.now() + 50 * 60_000;
    tokenCache.set(cacheKey, { token: r.token, until });
    return r.token;
  }

  const price = (cents: number) => Math.round(cents) / 100;

  return {
    async verify() {
      tokenCache.delete(cacheKey);
      await token();
      // The business details, when the key may read them.
      const b = await request<{ name?: string }>("/businesses/me").catch(() => ({ name: undefined }));
      return { businessName: b.name ?? null };
    },

    async issue(req: InvoiceRequest): Promise<IssuedInvoice> {
      const exempt = req.vatRate === 0;
      const body = {
        description: req.description.slice(0, 200),
        remarks: req.remarks.slice(0, 500),
        type: Number(cfg.documentType),
        date: req.date,
        lang: req.locale,
        currency: req.currency,
        // 0: the business's default VAT handling; prices below include VAT (vatType 1) or are exempt (2).
        vatType: 0,
        signed: true,
        rounding: false,
        client: {
          name: req.client.name.slice(0, 120),
          ...(cfg.emailClient && req.client.email ? { emails: [req.client.email] } : {}),
          ...(req.client.phone ? { phone: req.client.phone } : {}),
          ...(req.client.taxId ? { taxId: req.client.taxId } : {}),
          // Don't add every client to the service's address book.
          add: false,
        },
        // One line for the amount actually paid keeps the document equal to the payment, VAT included.
        income: [{ description: req.description.slice(0, 200), quantity: 1, price: price(req.totalCents), currency: req.currency, vatType: exempt ? 2 : 1 }],
        payment: [{ type: PAYMENT_TYPE[req.paymentMethod], price: price(req.totalCents), currency: req.currency, date: req.date }],
        // Our payment id, to find the document again.
        reference: req.reference,
      };
      const r = await request<{ id?: string; number?: string | number; url?: { he?: string; en?: string; origin?: string } }>("/documents", { method: "POST", body: JSON.stringify(body) });
      if (!r.id || r.number === undefined) throw new InvoiceError("Green Invoice returned no document", false);
      return { externalId: String(r.id), number: String(r.number), url: r.url?.origin ?? r.url?.he ?? r.url?.en ?? null };
    },

    async downloadPdf(issued) {
      if (!issued.url) return null;
      let u: URL;
      try {
        u = new URL(issued.url);
      } catch {
        return null;
      }
      const allowed = u.host === new URL(base).host || (u.protocol === "https:" && PDF_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)));
      if (!allowed) return null;
      const res = await fetch(u, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!res?.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.subarray(0, 4).toString() === "%PDF" ? buf : null;
    },
  };
}

/** For tests. */
export function _resetGreenInvoiceTokens() {
  tokenCache.clear();
}
