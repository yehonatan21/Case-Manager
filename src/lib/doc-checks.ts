import type { DocumentDetails } from "./db/schema";

/**
 * Checks on a case's identity and official documents, from their confirmed (or AI-suggested) details:
 * expired or soon-expiring documents, names that don't match the client or each other, and ID numbers or birth
 * dates that differ between documents. A person decides what to do; nothing is approved or rejected here.
 */
export type DocFinding = {
  documentId: string;
  kind: "expired" | "expiring" | "name_mismatch" | "id_mismatch" | "birth_mismatch" | "unreadable" | "unconfirmed";
  severity: "error" | "warning" | "info";
  /** Values for the message: the other document's title, the date... */
  vars: Record<string, string>;
};

export type CheckedDoc = { id: string; title: string; details: DocumentDetails | null; readable?: boolean | null };

/** How long before expiry a document is flagged (many authorities want a passport valid for 6 months). */
export const EXPIRY_WARNING_DAYS = 183;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const HEBREW = /[֐-׿]/;
const LATIN = /[a-z]/i;
const script = (s: string) => (HEBREW.test(s) ? "he" : LATIN.test(s) ? "latin" : "other");
/** Lower case, no punctuation or niqqud, single spaces. */
export const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
/**
 * Two names in the same script match when all the words of the shorter are in the longer (so a middle name or
 * a second surname doesn't count as a mismatch). Names in different scripts can't be compared and match.
 */
export function namesMatch(a: string, b: string) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y || script(x) !== script(y)) return true;
  const [short, long] = x.split(" ").length <= y.split(" ").length ? [x, y] : [y, x];
  const words = new Set(long.split(" "));
  return short.split(" ").every((w) => words.has(w));
}
const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

export function checkDocuments(docs: CheckedDoc[], clientName: string, today: string): DocFinding[] {
  const out: DocFinding[] = [];
  const soon = addDays(today, EXPIRY_WARNING_DAYS);
  for (const doc of docs) {
    const det = doc.details ?? {};
    if (doc.readable === false) out.push({ documentId: doc.id, kind: "unreadable", severity: "warning", vars: {} });
    if (det.source === "ai") out.push({ documentId: doc.id, kind: "unconfirmed", severity: "info", vars: {} });
    if (det.expiryDate) {
      if (det.expiryDate < today) out.push({ documentId: doc.id, kind: "expired", severity: "error", vars: { date: det.expiryDate } });
      else if (det.expiryDate <= soon) out.push({ documentId: doc.id, kind: "expiring", severity: "warning", vars: { date: det.expiryDate } });
    }
    if (det.fullName && clientName && !namesMatch(det.fullName, clientName)) {
      out.push({ documentId: doc.id, kind: "name_mismatch", severity: "warning", vars: { name: det.fullName, other: clientName } });
    }
  }
  // Between documents: report each pair once, on the later one in the list.
  for (let i = 0; i < docs.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = docs[i]!.details ?? {};
      const b = docs[j]!.details ?? {};
      const other = docs[j]!.title;
      if (a.idNumber && b.idNumber && digits(a.idNumber) && digits(b.idNumber) && digits(a.idNumber) !== digits(b.idNumber)) {
        out.push({ documentId: docs[i]!.id, kind: "id_mismatch", severity: "error", vars: { other, value: a.idNumber, otherValue: b.idNumber } });
      }
      if (a.birthDate && b.birthDate && a.birthDate !== b.birthDate) {
        out.push({ documentId: docs[i]!.id, kind: "birth_mismatch", severity: "error", vars: { other, value: a.birthDate, otherValue: b.birthDate } });
      }
      // With a client name each document is already compared to it; between documents only without one.
      if (!clientName && a.fullName && b.fullName && !namesMatch(a.fullName, b.fullName)) {
        out.push({ documentId: docs[i]!.id, kind: "name_mismatch", severity: "warning", vars: { name: a.fullName, other: `${b.fullName} (${other})` } });
      }
    }
  }
  return out;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Trims the details and drops invalid dates; returns null when nothing is left. */
export function cleanDetails(input: DocumentDetails, source: "ai" | "staff"): DocumentDetails | null {
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const day = (v: unknown) => (typeof v === "string" && DAY_RE.test(v.trim()) ? v.trim() : undefined);
  const out: DocumentDetails = {
    docType: text(input.docType, 80),
    fullName: text(input.fullName, 160),
    idNumber: text(input.idNumber, 40),
    birthDate: day(input.birthDate),
    issueDate: day(input.issueDate),
    expiryDate: day(input.expiryDate),
  };
  const filled = Object.values(out).some(Boolean);
  return filled ? { ...Object.fromEntries(Object.entries(out).filter(([, v]) => v)), source } : null;
}
