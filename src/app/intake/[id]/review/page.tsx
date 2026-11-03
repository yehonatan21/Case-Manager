import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { RequestReview } from "@/components/intake/request-review";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { summaryFromMessages } from "@/lib/services/intake";
import { isStaffRole } from "@/lib/domain";
import { loadIntake } from "../../_load";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.review.title };
}

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ manual?: string }> }) {
  const { id } = await params;
  const { manual } = await searchParams;
  const { d } = await getDict();
  const { session, user } = await loadIntake(id);
  if (!session) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <EmptyState title={d.intake.notFound} action={<ButtonLink href="/">{d.intake.startNew}</ButtonLink>} />
      </div>
    );
  }
  if (session.status === "submitted" && session.caseId) redirect(`/portal/cases/${session.caseId}`);
  // Without a usable AI summary, prefill from what the customer wrote — nothing is lost.
  const base = summaryFromMessages(session);
  const summary = session.summary && session.summary.request_title ? session.summary : { ...(session.summary ?? base), ...base };
  return (
    <RequestReview
      intakeId={session.id}
      summary={summary}
      mode={manual ? "manual" : "review"}
      user={user ? { name: user.name, isStaff: isStaffRole(user.role) } : null}
    />
  );
}
