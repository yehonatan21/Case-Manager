import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomers } from "@/lib/services/customers";
import { canSeeCustomers } from "@/lib/auth/permissions";
import { EmptyState, PageHeader } from "@/components/ui/misc";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.customersTitle };
}

export default async function CustomersPage() {
  const user = await requirePageStaff("/admin/customers");
  if (!canSeeCustomers(user.role)) redirect("/admin");
  const { d, locale } = await getDict();
  const rows = await listCustomers(await getDb());
  return (
    <>
      <PageHeader title={d.admin.customersTitle} />
      {rows.length === 0 ? (
        <EmptyState title={d.admin.customersEmpty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{d.common.name}</th>
                <th className="px-4 py-3 text-start font-medium">{d.common.email}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.type}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.cases}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.joined}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${r.id}`} className="bidi-auto font-medium text-slate-900 hover:text-brand-700 hover:underline">
                      {r.name}
                    </Link>
                    {r.organization && <span className="bidi-auto block text-xs text-slate-500">{r.organization}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">{r.email}</td>
                  <td className="px-4 py-3 text-slate-600">{d.customerType[r.type]}</td>
                  <td className="px-4 py-3 tabular-nums">{r.caseCount}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
