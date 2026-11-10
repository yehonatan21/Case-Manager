import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listPayments, PAYMENT_SORTS, PAYMENT_STATUSES, paymentProviders } from "@/lib/services/payments";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { GrowConnect } from "@/components/admin/grow-connect";
import { getPaymentProviderStatus } from "@/lib/services/payment-settings";
import { invoicesForPayments } from "@/lib/services/invoices";
import { InvoiceCell } from "@/components/admin/invoice-cell";
import { documentFiles } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pager } from "@/components/ui/pager";
import { CardList, RecordCard, TableFrame } from "@/components/ui/record-card";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.paymentsTitle };
}

type Search = { q?: string; status?: string; provider?: string; from?: string; to?: string; min?: string; max?: string; sort?: string; page?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaffPage("/admin/payments", "payments");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.filterBar;
  const db = await getDb();
  const [list, providerStatus, providers] = await Promise.all([listPayments(db, user, { ...sp, page: Number(sp.page) || 1 }), getPaymentProviderStatus(db), paymentProviders(db, user)]);
  const rows = list.rows;
  const values = { q: sp.q, status: sp.status, provider: sp.provider, from: sp.from, to: sp.to, min: sp.min, max: sp.max };
  const filtered = Object.values(values).some(Boolean);
  const invoiceCell = (p: (typeof rows)[number]["p"]) => {
    const inv = invs.get(p.id);
    return (
      <InvoiceCell
        paymentId={p.id}
        paid={p.status === "succeeded"}
        canIssue={user.role === "admin" || user.role === "finance"}
        invoice={inv ? { status: inv.status, number: inv.number, url: inv.url, error: inv.error, documentFileId: files.find((f) => f.documentId === inv.documentId)?.id ?? null } : null}
      />
    );
  };
  const statusBadge = (p: (typeof rows)[number]["p"]) => <Badge tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{d.paymentStatus[p.status]}</Badge>;
  const invs = await invoicesForPayments(db, rows.map((r) => r.p.id));
  const docIds = [...invs.values()].map((i) => i.documentId).filter((x): x is string => !!x);
  const files = docIds.length ? await db.select({ id: documentFiles.id, documentId: documentFiles.documentId }).from(documentFiles).where(inArray(documentFiles.documentId, docIds)) : [];
  return (
    <>
      <PageHeader title={d.admin.paymentsTitle} subtitle={d.quote.receiptsNote} />
      <GrowConnect status={providerStatus} canEdit={user.role === "admin"} />
      <FilterBar
        d={d}
        basePath="/admin/payments"
        values={{ ...values, sort: sp.sort }}
        total={list.total}
        fields={[
          { type: "search", name: "q", label: t.search, placeholder: t.paymentsSearch },
          { type: "select", name: "status", label: t.status, options: PAYMENT_STATUSES.map((s) => ({ value: s, label: d.paymentStatus[s] })) },
          { type: "select", name: "provider", label: t.provider, options: providers.map((p) => ({ value: p, label: p })) },
          { type: "date", name: "from", label: t.from, range: "from" },
          { type: "date", name: "to", label: t.to, range: "to" },
          { type: "amount", name: "min", label: t.minAmount },
          { type: "amount", name: "max", label: t.maxAmount },
          { type: "select", name: "sort", label: t.sort, any: false, options: PAYMENT_SORTS.map((s) => ({ value: s, label: t.sorts[s] })) },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title={filtered ? t.noMatch : d.admin.paymentsEmpty} />
      ) : (
        <>
        <TableFrame>
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
                    {statusBadge(r.p)}
                  </td>
                  <td className="px-4 py-3">
                    {invoiceCell(r.p)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        <CardList>
          {rows.map((r) => (
            <RecordCard
              key={r.p.id}
              href={`/admin/cases/${r.caseId}?tab=quotes`}
              eyebrow={
                <>
                  <span className="font-mono" dir="ltr">
                    {r.caseNumber}
                  </span>{" "}
                  · <span className="bidi-auto">{r.customerName}</span>
                </>
              }
              title={<span className="tabular-nums">{formatMoney(r.p.amountCents, r.p.currency, locale)}</span>}
              status={statusBadge(r.p)}
              details={[
                { label: d.quote.service, value: <span className="bidi-auto">{r.serviceName}</span>, wide: true },
                { label: d.common.date, value: formatDateTime(r.p.paidAt ?? r.p.createdAt, locale) },
                { label: d.admin.col.provider, value: r.p.provider },
              ]}
              footer={
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-xs text-slate-500">{d.invoices.document}</span>
                  {invoiceCell(r.p)}
                </div>
              }
            />
          ))}
        </CardList>
        </>
      )}
      <Pager d={d} page={list.page} pages={list.pages} basePath="/admin/payments" params={{ ...values, sort: sp.sort }} />
    </>
  );
}
