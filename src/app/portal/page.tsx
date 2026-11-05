import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { requirePageCustomer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomerCases } from "@/lib/services/cases";
import { CaseCard } from "@/components/portal/case-card";
import { PortalActions } from "@/components/portal/portal-actions";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { FolderOpen, Plus } from "lucide-react";
import { AiConsentPrompt } from "@/components/portal/ai-consent-prompt";

export default async function PortalHome() {
  const user = await requirePageCustomer("/portal");
  const { d } = await getDict();
  const cases = await listCustomerCases(await getDb(), user);
  const withActions = cases.filter((c) => c.actions.length > 0);
  return (
    <>
      <PageHeader title={fmt(d.portal.welcome, { name: user.name.split(" ")[0] ?? user.name })} subtitle={d.portal.welcomeSub} />
      {/* Never asked about AI (an account the team opened for them). */}
      {!user.aiConsentAt && !user.aiConsentDeclinedAt && <AiConsentPrompt />}
      {cases.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-10" />}
          title={d.portal.emptyTitle}
          text={d.portal.emptyText}
          action={
            <ButtonLink href="/portal/new" size="lg">
              <Plus className="size-4" /> {d.portal.emptyCta}
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">{d.portal.actionsTitle}</h2>
            <PortalActions items={withActions.flatMap((c) => c.actions.slice(0, 2).map((a) => ({ caseId: c.id, caseTitle: c.title, number: c.number, action: a })))} />
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{d.portal.recentCases}</h2>
              {cases.length > 4 && (
                <a href="/portal/cases" className="text-sm font-medium text-brand-700 hover:underline">
                  {d.portal.viewAll}
                </a>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {cases.slice(0, 4).map((c) => (
                <CaseCard key={c.id} c={c} />
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
