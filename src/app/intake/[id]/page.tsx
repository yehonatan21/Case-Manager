import { getDict } from "@/lib/i18n/server";
import { publicIntake } from "@/app/api/intake/_view";
import { IntakeChat } from "@/components/intake/intake-chat";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { loadIntake } from "../_load";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.intake.title };
}

export default async function IntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { d } = await getDict();
  const { session } = await loadIntake(id);
  if (!session) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <EmptyState title={d.intake.notFound} action={<ButtonLink href="/">{d.intake.startNew}</ButtonLink>} />
      </div>
    );
  }
  if (session.status === "submitted" && session.caseId) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <EmptyState title={d.intake.alreadySubmitted} action={<ButtonLink href={`/portal/cases/${session.caseId}`}>{d.intake.goToCase}</ButtonLink>} />
      </div>
    );
  }
  return <IntakeChat initial={publicIntake(session)} />;
}
