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
import { GrowConnect } from "@/components/admin/grow-connect";
import { getPaymentProviderStatus } from "@/lib/services/payment-settings";
import { invoicesForPayments } from "@/lib/services/invoices";
import { InvoiceCell } from "@/components/admin/invoice-cell";
import { documentFiles } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.paymentsTitle };
}

export default async function PaymentsPage() {
  const user = await requirePageStaff("/admin/payments");
  if (!canSeePayments(user.role)) redirect("/admin");
  const { d, locale } = await getDict();
  const db = await getDb();
  const [rows, providerStatus] = await Promise.all([listPayments(db, user), getPaymentProviderStatus(db)]);
  const invs = await invoicesForPayments(db, rows.map((r) => r.p.id));
  const docIds = [...invs.values()].map((i) => i.documentId).filter((x): x is string => !!x);
  const files = docIds.length ? await db.select({ id: documentFiles.id, documentId: documentFiles.documentId }).from(documentFiles).where(inArray(documentFiles.documentId, docIds)) : [];
  return (
    <>
      <PageHeader title={d.admin.paymentsTitle} subtitle={d.quote.receiptsNote} />
      <GrowConnect status={providerStatus} canEdit={user.role === "admin"} />
      {rows.length === 0 ? (
        <EmptyState title={d.admin.paymentsEmpty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.case}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.customer}</th>
                <th className="px-4 py-3 text-start font-medium">{d.quote.service}</th>
                <th className="px-4 py-3 text-end font-medium">{d.admin.col.amount}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.provider}</th>
                <th className="px-4 py-3 text-start font-medium">{d.common.date}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.status}</th>
                <th className="px-4 py-3 text-start font-medium">{d.invoices.document}</th>
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
                  <td className="px-4 py-3">
                    {(() => {
                      const inv = invs.get(r.p.id);
                      return (
                        <InvoiceCell
                          paymentId={r.p.id}
                          paid={r.p.status === "succeeded"}
                          canIssue={user.role === "admin" || user.role === "finance"}
                          invoice={inv ? { status: inv.status, number: inv.number, url: inv.url, error: inv.error, documentFileId: files.find((f) => f.documentId === inv.documentId)?.id ?? null } : null}
                        />
                      );
                    })()}
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
