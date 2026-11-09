import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatDate, formatMoney } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listQuotesForStaff, QUOTE_STATUSES } from "@/lib/services/quotes";
import { isQuoteExpired } from "@/lib/services/cases";
import { canSeeAllQuotes } from "@/lib/auth/permissions";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { QuoteStatusBadge } from "@/components/app/status";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pager } from "@/components/ui/pager";
import { CardList, RecordCard, TableFrame } from "@/components/ui/record-card";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.quotesTitle };
}

type Search = { q?: string; status?: string; from?: string; to?: string; page?: string };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageStaff("/admin/quotes");
  if (!canSeeAllQuotes(user.role)) redirect("/admin");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.filterBar;
  const list = await listQuotesForStaff(await getDb(), user, { ...sp, page: Number(sp.page) || 1 });
  const rows = list.rows;
  const values = { q: sp.q, status: sp.status, from: sp.from, to: sp.to };
  const filtered = Object.values(values).some(Boolean);
  return (
    <>
      <PageHeader title={d.admin.quotesTitle} />
      <FilterBar
        d={d}
        basePath="/admin/quotes"
        values={values}
        total={list.total}
        fields={[
          { type: "search", name: "q", label: t.search, placeholder: t.quotesSearch },
          { type: "select", name: "status", label: t.status, options: QUOTE_STATUSES.map((s) => ({ value: s, label: d.quoteStatus[s] })) },
          { type: "date", name: "from", label: t.from },
          { type: "date", name: "to", label: t.to },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title={filtered ? t.noMatch : d.admin.quotesEmpty} />
      ) : (
        <>
        <TableFrame>
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.case}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.customer}</th>
                <th className="px-4 py-3 text-start font-medium">{d.quote.service}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.version}</th>
                <th className="px-4 py-3 text-end font-medium">{d.admin.col.total}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.updated}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.quote.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                    <Link href={`/admin/cases/${r.caseId}?tab=quotes`} className="text-brand-700 hover:underline">
                      {r.caseNumber}
                    </Link>
                  </td>
                  <td className="bidi-auto px-4 py-3">{r.customerName}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/quotes/${r.quote.id}`} className="bidi-auto font-medium text-slate-900 hover:text-brand-700 hover:underline">
                      {r.quote.serviceName || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{fmt(d.quote.version, { n: r.quote.version })}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{formatMoney(r.quote.totalCents, r.quote.currency, locale)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.quote.updatedAt, locale)}</td>
                  <td className="px-4 py-3">
                    <QuoteStatusBadge status={r.quote.status} expired={isQuoteExpired(r.quote)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        <CardList>
          {rows.map((r) => (
            <RecordCard
              key={r.quote.id}
              href={`/admin/quotes/${r.quote.id}`}
              eyebrow={
                <>
                  <span className="font-mono" dir="ltr">
                    {r.caseNumber}
                  </span>{" "}
                  · <span className="bidi-auto">{r.customerName}</span>
                </>
              }
              title={r.quote.serviceName || "—"}
              status={<QuoteStatusBadge status={r.quote.status} expired={isQuoteExpired(r.quote)} />}
              details={[
                { label: d.admin.col.total, value: <span className="tabular-nums">{formatMoney(r.quote.totalCents, r.quote.currency, locale)}</span> },
                { label: d.admin.col.updated, value: formatDate(r.quote.updatedAt, locale) },
                { label: d.admin.col.version, value: fmt(d.quote.version, { n: r.quote.version }) },
              ]}
            />
          ))}
        </CardList>
        </>
      )}
      <Pager d={d} page={list.page} pages={list.pages} basePath="/admin/quotes" params={values} />
    </>
  );
}
