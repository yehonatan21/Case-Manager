import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listStaffCases } from "@/lib/services/cases";
import { caseStatusEnum } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/misc";
import { CasesTable } from "@/components/admin/cases-table";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { toCaseRows } from "../_rows";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.casesTitle };
}

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ status?: string; assignee?: string; q?: string }> }) {
  const user = await requirePageStaff("/admin/cases");
  const sp = await searchParams;
  const { d } = await getDict();
  const status = sp.status ?? "open";
  const rows = await listStaffCases(await getDb(), user, { status, assignee: sp.assignee, q: sp.q });
  return (
    <>
      <PageHeader title={d.admin.casesTitle} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">
            {d.common.search}
          </label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder={d.common.searchPlaceholder} />
        </div>
        <Select name="status" defaultValue={status} aria-label={d.admin.filterStatus} className="w-auto">
          <option value="open">{d.admin.openOnly}</option>
          <option value="all">{d.common.all}</option>
          {caseStatusEnum.enumValues.map((s) => (
            <option key={s} value={s}>
              {d.status.internal[s]}
            </option>
          ))}
        </Select>
        <Select name="assignee" defaultValue={sp.assignee ?? ""} aria-label={d.admin.filterAssignee} className="w-auto">
          <option value="">{d.common.all}</option>
          <option value="me">{d.admin.onlyMine}</option>
          <option value="unassigned">{d.common.unassigned}</option>
        </Select>
        <Button type="submit" variant="outline">
          {d.common.filter}
        </Button>
      </form>
      <CasesTable rows={toCaseRows(rows)} variant="cases" empty={d.admin.casesEmpty} />
    </>
  );
}
