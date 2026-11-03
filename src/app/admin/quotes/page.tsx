import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatDate, formatMoney } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listQuotesForStaff } from "@/lib/services/quotes";
import { isQuoteExpired } from "@/lib/services/cases";
import { canSeeAllQuotes } from "@/lib/auth/permissions";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { QuoteStatusBadge } from "@/components/app/status";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.quotesTitle };
}

export default async function QuotesPage() {
  const user = await requirePageStaff("/admin/quotes");
  if (!canSeeAllQuotes(user.role)) redirect("/admin");
  const { d, locale } = await getDict();
  const rows = await listQuotesForStaff(await getDb(), user);
  return (
    <>
      <PageHeader title={d.admin.quotesTitle} />
      {rows.length === 0 ? (
        <EmptyState title={d.admin.quotesEmpty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
        </div>
      )}
    </>
  );
}
