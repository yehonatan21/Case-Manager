import { getDict } from "@/lib/i18n/server";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listStaffCases } from "@/lib/services/cases";
import { PageHeader } from "@/components/ui/misc";
import { CasesTable } from "@/components/admin/cases-table";
import { toCaseRows } from "../_rows";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.inboxTitle };
}

export default async function InboxPage() {
  const user = await requireStaffPage("/admin/inbox", "inbox");
  const { d } = await getDict();
  const rows = (await listStaffCases(await getDb(), user, { status: "open" })).filter((r) => r.status === "submitted" || !r.assigneeId);
  return (
    <>
      <PageHeader title={d.admin.inboxTitle} subtitle={d.admin.inboxSub} />
      <CasesTable rows={toCaseRows(rows)} variant="inbox" empty={d.admin.inboxEmpty} />
    </>
  );
}
