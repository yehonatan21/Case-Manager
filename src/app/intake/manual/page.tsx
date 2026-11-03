import { getDict } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { RequestReview } from "@/components/intake/request-review";
import { emptySummary } from "@/lib/services/intake";
import { isStaffRole } from "@/lib/domain";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.review.manualTitle };
}

export default async function ManualRequestPage() {
  const user = await getCurrentUser();
  return <RequestReview intakeId={null} summary={emptySummary()} mode="manual" user={user ? { name: user.name, isStaff: isStaffRole(user.role) } : null} />;
}
