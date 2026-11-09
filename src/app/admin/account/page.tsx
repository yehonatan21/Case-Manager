import { getDict } from "@/lib/i18n/server";
import { getDb } from "@/lib/db";
import { ACCOUNT_PATH, requirePageStaff } from "@/lib/auth/session";
import { getTwoFactorStatus } from "@/lib/services/two-factor";
import { PageHeader } from "@/components/ui/misc";
import { SecurityCard } from "@/components/account/security-card";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.twoFactor.accountTitle };
}

/** A team member's own account: sign-in security (two-step sign-in). */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const user = await requirePageStaff(ACCOUNT_PATH);
  const { setup } = await searchParams;
  const { d } = await getDict();
  const status = await getTwoFactorStatus(await getDb(), user);
  return (
    <div className="max-w-2xl">
      <PageHeader title={d.twoFactor.accountTitle} subtitle={d.twoFactor.accountSub} />
      <SecurityCard status={{ ...status, enabledAt: status.enabledAt ? status.enabledAt.toISOString() : null }} mustSetUp={setup === "1"} />
    </div>
  );
}
