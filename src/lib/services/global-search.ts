/**
 * The staff area's search (Ctrl/⌘+K): cases, incoming requests, clients and quotes in one place, each searched on
 * the server with the same rules as its own page — only records the person may see, and only kinds of record their
 * role may open (finance: no clients; staff: only their cases, no quotes). A few of each, newest activity first.
 */
import type { DbOrTx } from "../db";
import type { CaseStatus, QuoteStatus, User } from "../db/schema";
import { canOpenPage } from "../auth/permissions";
import { listStaffCases } from "./cases";
import { listCustomers } from "./customers";
import { listQuotesForStaff } from "./quotes";
import { searchTerm } from "./list-filters";

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_PER_KIND = 5;

export type SearchHit =
  | { kind: "case" | "request"; id: string; href: string; title: string; ref: string; context: string; status: CaseStatus }
  | { kind: "customer"; id: string; href: string; title: string; ref: string; context: string | null }
  | { kind: "quote"; id: string; href: string; title: string; ref: string; context: string; status: QuoteStatus };

export async function globalSearch(db: DbOrTx, actor: User, query: string): Promise<SearchHit[]> {
  const q = searchTerm(query);
  if (!q || q.length < SEARCH_MIN_LENGTH || !canOpenPage(actor.role, "cases")) return [];
  const [cases, customers, quotes] = await Promise.all([
    listStaffCases(db, actor, { q, limit: SEARCH_PER_KIND * 2 }),
    canOpenPage(actor.role, "customers") ? listCustomers(db, { q, pageSize: SEARCH_PER_KIND }).then((r) => r.rows) : Promise.resolve([]),
    canOpenPage(actor.role, "quotes") ? listQuotesForStaff(db, actor, { q, pageSize: SEARCH_PER_KIND }).then((r) => r.rows) : Promise.resolve([]),
  ]);
  // A new request waiting to be taken shows as such for those who handle the Incoming list; otherwise it's a case.
  const seesInbox = canOpenPage(actor.role, "inbox");
  const caseHits: SearchHit[] = cases.slice(0, SEARCH_PER_KIND * 2).map((c) => ({
    kind: seesInbox && c.status === "submitted" ? "request" : "case",
    id: c.id,
    href: `/admin/cases/${c.id}`,
    title: c.title,
    ref: c.number,
    context: c.customerName,
    status: c.status,
  }));
  const requests = caseHits.filter((h) => h.kind === "request").slice(0, SEARCH_PER_KIND);
  const others = caseHits.filter((h) => h.kind === "case").slice(0, SEARCH_PER_KIND);
  return [
    ...requests,
    ...others,
    ...customers.map((c): SearchHit => ({ kind: "customer", id: c.id, href: `/admin/customers/${c.id}`, title: c.name, ref: c.email, context: c.organization })),
    ...quotes.map(
      (r): SearchHit => ({
        kind: "quote",
        id: r.quote.id,
        href: `/admin/quotes/${r.quote.id}`,
        title: r.quote.serviceName || r.caseTitle,
        ref: r.caseNumber,
        context: r.customerName,
        status: r.quote.status,
      }),
    ),
  ];
}
