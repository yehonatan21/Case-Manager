import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listPayments } from "@/lib/services/payments";
import { canSeePayments } from "@/lib/auth/permissions";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.paymentsTitle };
}

export default async function PaymentsPage() {
  const user = await requirePageStaff("/admin/payments");
  if (!canSeePayments(user.role)) redirect("/admin");
  const { d, locale } = await getDict();
  const rows = await listPayments(await getDb(), user);
  return (
    <>
      <PageHeader title={d.admin.paymentsTitle} subtitle={d.quote.receiptsNote} />
      {rows.length === 0 ? (
        <EmptyState title={d.admin.paymentsEmpty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.case}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.customer}</th>
                <th className="px-4 py-3 text-start font-medium">{d.quote.service}</th>
                <th className="px-4 py-3 text-end font-medium">{d.admin.col.amount}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.provider}</th>
                <th className="px-4 py-3 text-start font-medium">{d.common.date}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.p.id}>
                  <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                    <Link href={`/admin/cases/${r.caseId}?tab=quotes`} className="text-brand-700 hover:underline">
                      {r.caseNumber}
                    </Link>
                  </td>
                  <td className="bidi-auto px-4 py-3">{r.customerName}</td>
                  <td className="bidi-auto px-4 py-3">{r.serviceName}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{formatMoney(r.p.amountCents, r.p.currency, locale)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.p.provider}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(r.p.paidAt ?? r.p.createdAt, locale)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.p.status === "succeeded" ? "success" : r.p.status === "failed" ? "danger" : "neutral"}>{d.paymentStatus[r.p.status]}</Badge>
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
