/**
 * Signed PDFs.
 *
 * - `signPdf`: the original PDF, unchanged except for a one-line "signed electronically" stamp in each page's
 *   bottom margin, followed by a signature certificate page (signer, time, IP, device, method, the original's
 *   SHA-256 fingerprint, and the drawn signature or typed name).
 * - `signedQuotePdf`: the approved quote version rendered as a PDF, with the same certificate page.
 *
 * The signed file's own fingerprint can't be printed inside it; it's recorded with the signature instead.
 */
import { PDFDocument, rgb, StandardFonts, type PDFImage, type PDFPage } from "pdf-lib";
import { embedFonts, Writer, type TextStyle } from "./text";
import type { Locale } from "../i18n/config";
import { dictionaries } from "../i18n/dictionaries";
import { fmt } from "../i18n/config";
import { formatDate, formatMoney } from "../i18n/format";

export type SignatureDetails = {
  reference: string;
  documentTitle: string;
  caseNumber: string;
  company: string;
  signerName: string;
  signerEmail: string;
  method: "typed" | "drawn";
  /** PNG bytes of the drawn signature. */
  image: Buffer | null;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  originalSha256: string;
};

export class UnsupportedPdfError extends Error {}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const GRAY = rgb(0.38, 0.42, 0.5);
const LINE = rgb(0.85, 0.87, 0.9);
const BRAND = rgb(0.26, 0.22, 0.79);

export function signedAtText(d: Date, locale: Locale) {
  const local = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { dateStyle: "long", timeStyle: "medium", timeZone: "Asia/Jerusalem" }).format(d);
  return `${local} (${dictionaries[locale].signatures.pdf.israelTime}) · ${d.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

/** The certificate page appended to every signed PDF. */
async function addCertificate(doc: PDFDocument, w: Writer, locale: Locale, s: SignatureDetails, image: PDFImage | null) {
  const t = dictionaries[locale].signatures.pdf;
  const page = doc.addPage(A4);
  const [width, height] = A4;
  const rtl = w.dir === "rtl";
  const start = rtl ? width - MARGIN : MARGIN;
  const end = rtl ? MARGIN : width - MARGIN;
  const inner = width - MARGIN * 2;
  let y = height - MARGIN - 10;

  w.line(page, t.certificateTitle, start, y, { size: 20, bold: true, color: BRAND });
  y -= 22;
  for (const l of w.wrap(fmt(t.certificateIntro, { company: s.company }), inner, { size: 10 })) {
    w.line(page, l, start, y, { size: 10, color: GRAY });
    y -= 14;
  }
  y -= 10;

  const rows: [string, string][] = [
    [t.document, s.documentTitle],
    [t.case, s.caseNumber],
    [t.signer, s.signerName],
    [t.email, s.signerEmail],
    [t.signedAt, signedAtText(s.signedAt, locale)],
    [t.ip, s.ip ?? "—"],
    [t.device, (s.userAgent ?? "—").slice(0, 160)],
    [t.method, s.method === "drawn" ? t.methodDrawn : t.methodTyped],
    [t.fingerprint, s.originalSha256],
    [t.reference, s.reference],
  ];
  const labelW = 150;
  for (const [label, value] of rows) {
    page.drawLine({ start: { x: MARGIN, y: y + 14 }, end: { x: width - MARGIN, y: y + 14 }, thickness: 0.5, color: LINE });
    w.line(page, label, start, y, { size: 10, bold: true });
    const valueStart = rtl ? start - labelW : start + labelW;
    const lines = w.wrap(value, inner - labelW, { size: 10 });
    for (const l of lines) {
      w.line(page, l, valueStart, y, { size: 10 });
      y -= 14;
    }
    y -= 8;
  }
  page.drawLine({ start: { x: MARGIN, y: y + 14 }, end: { x: width - MARGIN, y: y + 14 }, thickness: 0.5, color: LINE });

  // The signature itself.
  y -= 16;
  w.line(page, t.signature, start, y, { size: 10, bold: true });
  y -= 12;
  const boxH = 90;
  const boxW = 260;
  const boxX = rtl ? width - MARGIN - boxW : MARGIN;
  page.drawRectangle({ x: boxX, y: y - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 1 });
  if (image) {
    const scale = Math.min((boxW - 20) / image.width, (boxH - 20) / image.height, 1);
    const iw = image.width * scale;
    const ih = image.height * scale;
    page.drawImage(image, { x: boxX + (boxW - iw) / 2, y: y - boxH + (boxH - ih) / 2, width: iw, height: ih });
    w.line(page, s.signerName, boxX + boxW / 2, y - boxH - 14, { size: 10, color: GRAY }, "center");
    y -= 14;
  } else {
    w.line(page, s.signerName, boxX + boxW / 2, y - boxH / 2 - 8, { size: 22, bold: true, color: rgb(0.1, 0.1, 0.35) }, "center");
  }
  y -= boxH + 26;

  for (const l of w.wrap(t.legal, inner, { size: 8.5 })) {
    w.line(page, l, start, y, { size: 8.5, color: GRAY });
    y -= 12;
  }
  void end;
}

/** One-line stamp in the bottom margin of each page of the original. */
function stamp(page: PDFPage, w: Writer, locale: Locale, s: SignatureDetails) {
  const t = dictionaries[locale].signatures.pdf;
  const { width } = page.getSize();
  const text = fmt(t.stamp, { name: s.signerName, date: formatDate(s.signedAt, locale), ref: s.reference.slice(0, 8) });
  const size = 7;
  // A light band so the stamp stays readable over content that runs into the margin.
  const tw = w.width(text, { size });
  page.drawRectangle({ x: width / 2 - tw / 2 - 6, y: 8, width: tw + 12, height: 13, color: rgb(1, 1, 1), opacity: 0.85 });
  w.line(page, text, width / 2, 12, { size, color: GRAY }, "center");
}

async function embedSignature(doc: PDFDocument, png: Buffer | null) {
  if (!png) return null;
  try {
    return await doc.embedPng(png);
  } catch {
    return null;
  }
}

/** Stamps the original PDF and appends the certificate. Throws UnsupportedPdfError for encrypted or broken PDFs. */
export async function signPdf(original: Buffer, s: SignatureDetails, locale: Locale): Promise<Buffer> {
  // Encrypted, damaged or unusual PDFs can fail anywhere from loading to saving.
  try {
    const doc = await PDFDocument.load(original, { updateMetadata: false });
    if (doc.getPageCount() === 0) throw new Error("No pages");
    const fonts = await embedFonts(doc);
    const w = new Writer(fonts, locale === "he" ? "rtl" : "ltr");
    for (const page of doc.getPages()) stamp(page, w, locale, s);
    await addCertificate(doc, w, locale, s, await embedSignature(doc, s.image));
    doc.setModificationDate(s.signedAt);
    return Buffer.from(await doc.save());
  } catch (err) {
    throw new UnsupportedPdfError((err as Error).message);
  }
}

export type QuoteForPdf = {
  version: number;
  serviceName: string;
  scope: string;
  included: string;
  excluded: string;
  currency: string;
  taxRate: string | number;
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentTerms: string;
  timeline: string;
  terms: string;
  validUntil: string | null;
  items: { description: string; quantity: string | number; unitPriceCents: number }[];
};

/** The approved quote version as a PDF, signed: the quote pages, then the certificate. */
export async function signedQuotePdf(q: QuoteForPdf, s: SignatureDetails & { customerName: string }, locale: Locale): Promise<{ data: Buffer; originalSha256: string }> {
  const d = dictionaries[locale];
  const t = d.signatures.pdf;
  const doc = await PDFDocument.create();
  doc.setTitle(`${fmt(t.quoteTitle, { version: q.version })} — ${s.caseNumber}`);
  doc.setCreator(s.company);
  doc.setProducer(s.company);
  doc.setCreationDate(s.signedAt);
  doc.setModificationDate(s.signedAt);
  await doc.embedFont(StandardFonts.Helvetica); // keeps viewers that need a base font happy
  const fonts = await embedFonts(doc);
  const w = new Writer(fonts, locale === "he" ? "rtl" : "ltr");
  const [width, height] = A4;
  const rtl = w.dir === "rtl";
  const start = rtl ? width - MARGIN : MARGIN;
  const inner = width - MARGIN * 2;
  const money = (c: number) => formatMoney(c, q.currency, locale);

  let page = doc.addPage(A4);
  let y = height - MARGIN;
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 20) {
      page = doc.addPage(A4);
      y = height - MARGIN;
    }
  };
  const para = (text: string, style: TextStyle, gap = 4) => {
    for (const l of w.wrap(text, inner, style)) {
      ensure(style.size + 4);
      w.line(page, l, start, y, style);
      y -= style.size + 4;
    }
    y -= gap;
  };
  const heading = (text: string) => {
    ensure(40);
    y -= 6;
    w.line(page, text, start, y, { size: 12, bold: true, color: BRAND });
    y -= 18;
  };

  w.line(page, s.company, start, y, { size: 11, bold: true, color: GRAY });
  y -= 26;
  w.line(page, fmt(t.quoteTitle, { version: q.version }), start, y, { size: 22, bold: true });
  y -= 22;
  para(`${t.case}: ${s.caseNumber} · ${t.customer}: ${s.customerName}`, { size: 10, color: GRAY }, 0);
  if (q.validUntil) para(fmt(d.quote.validUntil, { date: formatDate(q.validUntil, locale) }), { size: 10, color: GRAY }, 0);
  y -= 10;

  heading(q.serviceName);
  if (q.scope) para(q.scope, { size: 10 });
  if (q.included) {
    heading(d.quote.included);
    para(q.included, { size: 10 });
  }
  if (q.excluded) {
    heading(d.quote.excluded);
    para(q.excluded, { size: 10 });
  }

  // Line items: description | quantity | unit price | total.
  heading(d.quote.items);
  const cols = [inner - 250, 50, 100, 100];
  const colStart = (i: number) => {
    const offset = cols.slice(0, i).reduce((a, b) => a + b, 0);
    return rtl ? start - offset : start + offset;
  };
  const row = (cells: string[], style: TextStyle) => {
    const wrapped = w.wrap(cells[0]!, cols[0]! - 10, style);
    ensure(wrapped.length * (style.size + 4) + 6);
    const top = y;
    wrapped.forEach((l, k) => w.line(page, l, colStart(0), top - k * (style.size + 4), style));
    for (let i = 1; i < cells.length; i++) w.line(page, cells[i]!, colStart(i), top, style, "end", cols[i]! - 6);
    y = top - wrapped.length * (style.size + 4) - 4;
    page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: width - MARGIN, y: y + 8 }, thickness: 0.5, color: LINE });
  };
  row([d.quote.item, d.quote.quantity, d.quote.unitPrice, d.quote.lineTotal], { size: 9, bold: true, color: GRAY });
  for (const it of q.items) {
    const qty = Number(it.quantity);
    row([it.description, String(qty), money(it.unitPriceCents), money(Math.round(qty * it.unitPriceCents))], { size: 10 });
  }
  y -= 6;
  const total = (label: string, value: string, bold = false) => {
    ensure(18);
    w.line(page, label, colStart(2), y, { size: 10, bold }, "start");
    w.line(page, value, colStart(3), y, { size: 10, bold }, "end", cols[3]! - 6);
    y -= 16;
  };
  total(d.quote.subtotal, money(q.subtotalCents));
  total(fmt(d.quote.vat, { rate: Number(q.taxRate) }), money(q.taxCents));
  total(d.quote.total, money(q.totalCents), true);
  y -= 6;

  if (q.paymentTerms) {
    heading(d.quote.paymentTerms);
    para(q.paymentTerms, { size: 10 });
  }
  if (q.timeline) {
    heading(d.quote.timeline);
    para(q.timeline, { size: 10 });
  }
  if (q.terms) {
    heading(d.quote.terms);
    para(q.terms, { size: 10 });
  }

  ensure(60);
  y -= 10;
  para(fmt(t.quoteApproved, { name: s.signerName, date: signedAtText(s.signedAt, locale) }), { size: 10, bold: true });

  // Fingerprint of the quote pages as approved (before the certificate is added).
  const pages = await doc.save();
  const { createHash } = await import("node:crypto");
  const originalSha256 = createHash("sha256").update(pages).digest("hex");
  const reloaded = await PDFDocument.load(pages, { updateMetadata: false });
  const f2 = await embedFonts(reloaded);
  const w2 = new Writer(f2, w.dir);
  await addCertificate(reloaded, w2, locale, { ...s, originalSha256 }, await embedSignature(reloaded, s.image));
  return { data: Buffer.from(await reloaded.save()), originalSha256 };
}
