import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCustomer } from "@/lib/services/customers";
import { listStaffCases } from "@/lib/services/cases";
import { canSeeCustomers } from "@/lib/auth/permissions";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { CasesTable } from "@/components/admin/cases-table";
import { toCaseRows } from "../../_rows";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageStaff(`/admin/customers/${id}`);
  if (!canSeeCustomers(user.role)) redirect("/admin");
  const { d, locale } = await getDict();
  const db = await getDb();
  const row = await getCustomer(db, id);
  if (!row) return <EmptyState title={d.states.notFoundTitle} action={<ButtonLink href="/admin/customers">{d.admin.customersTitle}</ButtonLink>} />;
  const caseRows = await listStaffCases(db, user, { status: "all", customerId: id });
  return (
    <>
      <PageHeader title={row.user.name} subtitle={fmt(d.customersPage.since, { date: formatDate(row.customer.createdAt, locale) })} />
      <Card className="mb-6">
        <CardContent className="grid gap-4 py-5 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">{d.common.email}</p>
            <p dir="ltr" className="text-start">{row.user.email}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{d.common.phone}</p>
            <p dir="ltr" className="text-start">{row.user.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{d.account.customerType}</p>
            <p>{d.customerType[row.customer.type]}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{d.workspace.organization}</p>
            <p className="bidi-auto">
              {row.organization?.name ?? "—"} {row.organization?.businessId && <span className="text-slate-500">({row.organization.businessId})</span>}
            </p>
          </div>
        </CardContent>
      </Card>
      <h2 className="mb-3 text-lg font-semibold">{d.customersPage.cases}</h2>
      <CasesTable rows={toCaseRows(caseRows)} variant="cases" empty={d.customersPage.noCases} />
    </>
  );
}
