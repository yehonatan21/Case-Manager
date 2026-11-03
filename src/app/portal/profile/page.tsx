import { getDict } from "@/lib/i18n/server";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCustomerForUser } from "@/lib/services/users";
import { PageHeader } from "@/components/ui/misc";
import { ProfileForm } from "@/components/app/profile-form";
import { LogoutButton } from "@/components/app/logout-button";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.portal.profileTitle };
}

export default async function ProfilePage() {
  const user = await requirePageUser("/portal/profile");
  const { d } = await getDict();
  const cust = await getCustomerForUser(await getDb(), user.id);
  return (
    <div className="max-w-2xl">
      <PageHeader title={d.portal.profileTitle} actions={<LogoutButton className="sm:hidden" />} />
      <ProfileForm
        user={{ name: user.name, email: user.email, phone: user.phone, locale: user.locale, emailNotifications: user.emailNotifications }}
        customerType={cust?.customer.type ?? null}
        organization={cust?.organization?.name ?? null}
      />
    </div>
  );
}
