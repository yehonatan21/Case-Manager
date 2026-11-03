import { getDict } from "@/lib/i18n/server";
import { requirePageCustomer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomerCases } from "@/lib/services/cases";
import { CaseCard } from "@/components/portal/case-card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { FolderOpen, Plus } from "lucide-react";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.portal.casesTitle };
}

export default async function MyCases() {
  const user = await requirePageCustomer("/portal/cases");
  const { d } = await getDict();
  const cases = await listCustomerCases(await getDb(), user);
  return (
    <>
      <PageHeader
        title={d.portal.casesTitle}
        actions={
          <ButtonLink href="/portal/new">
            <Plus className="size-4" /> {d.nav.newRequest}
          </ButtonLink>
        }
      />
      {cases.length === 0 ? (
        <EmptyState icon={<FolderOpen className="size-10" />} title={d.portal.emptyTitle} text={d.portal.emptyText} action={<ButtonLink href="/portal/new">{d.portal.emptyCta}</ButtonLink>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <CaseCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </>
  );
}
