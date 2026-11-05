/**
 * The app's own payment confirmation (אישור תשלום), saved when no invoicing service is connected. It states that
 * it is not a tax document: tax invoices and receipts come from certified invoicing software (e.g. Green Invoice).
 */
import { PDFDocument, rgb } from "pdf-lib";
import { embedFonts, Writer } from "./text";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { formatDateTime, formatMoney } from "../i18n/format";

export type ConfirmationInput = {
  company: string;
  companyEmail: string;
  companyPhone: string;
  reference: string;
  clientName: string;
  clientEmail: string;
  caseNumber: string;
  service: string;
  quoteVersion: number | null;
  amountCents: number;
  currency: string;
  paidAt: Date;
  provider: string;
};

export async function paymentConfirmationPdf(i: ConfirmationInput, locale: Locale): Promise<Buffer> {
  const t = dictionaries[locale].invoices.pdf;
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} — ${i.caseNumber}`);
  doc.setCreator(i.company);
  const w = new Writer(await embedFonts(doc), locale === "he" ? "rtl" : "ltr");
  const page = doc.addPage([595.28, 841.89]);
  const rtl = w.dir === "rtl";
  const M = 50;
  const start = rtl ? 595.28 - M : M;
  let y = 841.89 - M;
  const GRAY = rgb(0.38, 0.42, 0.5);
  w.line(page, i.company, start, y, { size: 12, bold: true, color: GRAY });
  y -= 15;
  w.line(page, [i.companyEmail, i.companyPhone].filter(Boolean).join(" · "), start, y, { size: 9, color: GRAY });
  y -= 36;
  w.line(page, t.title, start, y, { size: 22, bold: true });
  y -= 30;
  const rows: [string, string][] = [
    [t.amount, formatMoney(i.amountCents, i.currency, locale)],
    [t.paidAt, formatDateTime(i.paidAt, locale)],
    [t.client, `${i.clientName} (${i.clientEmail})`],
    [t.case, i.caseNumber],
    [t.service, i.quoteVersion ? fmt(t.serviceVersion, { service: i.service, version: i.quoteVersion }) : i.service],
    [t.method, i.provider],
    [t.reference, i.reference],
  ];
  for (const [label, value] of rows) {
    page.drawLine({ start: { x: M, y: y + 14 }, end: { x: 595.28 - M, y: y + 14 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
    w.line(page, label, start, y, { size: 10, bold: true });
    w.line(page, value, rtl ? start - 150 : start + 150, y, { size: 10 });
    y -= 24;
  }
  y -= 16;
  for (const l of w.wrap(t.notTax, 595.28 - 2 * M, { size: 9 })) {
    w.line(page, l, start, y, { size: 9, color: GRAY });
    y -= 13;
  }
  return Buffer.from(await doc.save());
}
