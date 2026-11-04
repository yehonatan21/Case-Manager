import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomers } from "@/lib/services/customers";
import { canCreateCasesForClients } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/misc";
import { NewCaseForm } from "@/components/admin/new-case-form";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.newCase.title };
}

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const user = await requirePageStaff("/admin/cases/new");
  if (!canCreateCasesForClients(user.role)) redirect("/admin/cases");
  const { d } = await getDict();
  const { customer } = await searchParams;
  const clients = (await listCustomers(await getDb())).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    organization: c.organization,
  }));
  return (
    <>
      <PageHeader title={d.newCase.title} subtitle={d.newCase.subtitle} />
      <NewCaseForm clients={clients} initialClientId={customer} />
    </>
  );
}
