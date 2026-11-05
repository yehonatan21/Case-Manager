import { getDict } from "@/lib/i18n/server";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCustomerForUser } from "@/lib/services/users";
import { PageHeader } from "@/components/ui/misc";
import { ProfileForm } from "@/components/app/profile-form";
import { LogoutButton } from "@/components/app/logout-button";
import { PushToggle } from "@/components/app/push-toggle";
import { isWhatsAppEnabled } from "@/lib/services/whatsapp";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.portal.profileTitle };
}

export default async function ProfilePage() {
  const user = await requirePageUser("/portal/profile");
  const { d } = await getDict();
  const db = await getDb();
  const [cust, whatsappAvailable] = await Promise.all([getCustomerForUser(db, user.id), isWhatsAppEnabled(db)]);
  return (
    <div className="max-w-2xl">
      <PageHeader title={d.portal.profileTitle} actions={<LogoutButton className="sm:hidden" />} />
      <ProfileForm
        user={{ name: user.name, email: user.email, phone: user.phone, locale: user.locale, emailNotifications: user.emailNotifications, whatsapp: !!user.whatsappOptInAt }}
        whatsappAvailable={whatsappAvailable}
        customerType={cust?.customer.type ?? null}
        organization={cust?.organization?.name ?? null}
      />
      <PushToggle className="mt-6 rounded-xl border border-slate-200 bg-white p-4" />
    </div>
  );
}
