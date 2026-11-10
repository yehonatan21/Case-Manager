import { getDict } from "@/lib/i18n/server";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCustomer, listCustomers } from "@/lib/services/customers";
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
  const user = await requireStaffPage("/admin/cases/new", "newCase");
  const { d } = await getDict();
  const { customer } = await searchParams;
  const db = await getDb();
  const list = (await listCustomers(db, { pageSize: 500 })).rows;
  // A client picked from their page may be older than the newest 500.
  const picked = customer && !list.some((c) => c.id === customer) ? await getCustomer(db, customer) : null;
  if (picked) list.unshift({ id: picked.customer.id, type: picked.customer.type, createdAt: picked.customer.createdAt, name: picked.user.name, email: picked.user.email, phone: picked.user.phone, organization: picked.organization?.name ?? null, caseCount: 0 });
  const clients = list.map((c) => ({
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
