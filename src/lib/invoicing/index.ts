/**
 * Invoicing (receipts and tax invoices) behind a small provider interface, so Green Invoice (Morning) can be joined
 * or replaced by another Israeli service (iCount, EZcount, Grow's documents…) without touching the rest of the app.
 */
import { createGreenInvoiceProvider } from "./greeninvoice";

export type InvoiceProviderName = "greeninvoice";

export type InvoiceConfig = {
  provider: InvoiceProviderName;
  apiKeyId: string;
  apiSecret: string;
  sandbox: boolean;
  /** Provider document type: 320 = חשבונית מס קבלה (VAT-registered), 400 = קבלה (e.g. exempt businesses). */
  documentType: "320" | "400";
  /** Issue automatically when a payment succeeds (otherwise staff issue it by hand). */
  autoIssue: boolean;
  /** Let the service email the document to the client. */
  emailClient: boolean;
  /** Base URL override (tests). */
  apiUrl?: string | null;
};

export type InvoiceRequest = {
  /** Our payment id: sent as a reference so a retry can be matched. */
  reference: string;
  date: string; // YYYY-MM-DD (Israel time)
  currency: string;
  /** The amount actually paid, VAT included where applicable. */
  totalCents: number;
  /** 0 when the business doesn't charge VAT (exempt) or the quote had no VAT. */
  vatRate: number;
  description: string;
  lines: { description: string; quantity: number; unitPriceCents: number }[];
  client: { name: string; email: string | null; phone: string | null; taxId: string | null };
  paymentMethod: "credit_card" | "bit" | "bank_transfer" | "other";
  locale: "he" | "en";
  remarks: string;
};

export type IssuedInvoice = { externalId: string; number: string; url: string | null };

export class InvoiceError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

export interface InvoiceProvider {
  /** Checks the credentials (and returns the business name when the service tells it). */
  verify(): Promise<{ businessName: string | null }>;
  issue(req: InvoiceRequest): Promise<IssuedInvoice>;
  /** Downloads the document's PDF, when the service provides a download link. */
  downloadPdf(issued: IssuedInvoice): Promise<Buffer | null>;
}

export function invoiceProvider(cfg: InvoiceConfig): InvoiceProvider {
  return createGreenInvoiceProvider(cfg);
}

export const INVOICE_PROVIDERS: InvoiceProviderName[] = ["greeninvoice"];
