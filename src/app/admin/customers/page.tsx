import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomers } from "@/lib/services/customers";
import { canSeeCustomers } from "@/lib/auth/permissions";
import { customerTypeEnum } from "@/lib/db/schema";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.customersTitle };
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; page?: string }> }) {
  const user = await requirePageStaff("/admin/customers");
  if (!canSeeCustomers(user.role)) redirect("/admin");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const list = await listCustomers(await getDb(), { q: sp.q, type: sp.type, page: Number(sp.page) || 1 });
  const filtered = !!(sp.q?.trim() || sp.type);
  return (
    <>
      <PageHeader title={d.admin.customersTitle} subtitle={fmt(d.admin.customersCount, { n: list.total })} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-56 flex-1">
          <label htmlFor="customers-q" className="sr-only">
            {d.common.search}
          </label>
          <Input id="customers-q" name="q" type="search" defaultValue={sp.q} placeholder={d.admin.customersSearch} />
        </div>
        <Select name="type" defaultValue={sp.type ?? ""} aria-label={d.admin.col.type} className="w-auto">
          <option value="">{d.common.all}</option>
          {customerTypeEnum.enumValues.map((t) => (
            <option key={t} value={t}>
              {d.customerType[t]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {d.common.search}
        </Button>
      </form>
      {list.rows.length === 0 ? (
        <EmptyState title={filtered ? d.admin.customersNoMatch : d.admin.customersEmpty} />
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
              {list.rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${r.id}`} className="bidi-auto font-medium text-slate-900 hover:text-brand-700 hover:underline">
                      {r.name}
                    </Link>
                    {r.organization && <span className="bidi-auto block text-xs text-slate-500">{r.organization}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <span dir="ltr">{r.email}</span>
                    {r.phone && (
                      <span className="block text-xs text-slate-500" dir="ltr">
                        {r.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.customerType[r.type]}</td>
                  <td className="px-4 py-3 tabular-nums">{r.caseCount}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager d={d} page={list.page} pages={list.pages} basePath="/admin/customers" params={{ q: sp.q, type: sp.type }} />
    </>
  );
}
