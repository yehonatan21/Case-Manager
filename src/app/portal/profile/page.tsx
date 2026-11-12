import { getDict } from "@/lib/i18n/server";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCustomerForUser } from "@/lib/services/users";
import { PageHeader } from "@/components/ui/misc";
import { ProfileForm } from "@/components/app/profile-form";
import { LogoutButton } from "@/components/app/logout-button";
import { PushToggle } from "@/components/app/push-toggle";
import { isWhatsAppEnabled } from "@/lib/services/whatsapp";
import { deletionPreview } from "@/lib/services/account-deletion";
import { DeleteAccountCard } from "@/components/account/delete-account";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.portal.profileTitle };
}

export default async function ProfilePage() {
  const user = await requirePageUser("/portal/profile");
  const { d } = await getDict();
  const db = await getDb();
  const [cust, whatsappAvailable, preview] = await Promise.all([
    getCustomerForUser(db, user.id),
    isWhatsAppEnabled(db),
    user.role === "customer" ? deletionPreview(db, user.id) : Promise.resolve(null),
  ]);
  return (
    <div className="max-w-2xl">
      <PageHeader title={d.portal.profileTitle} actions={<LogoutButton className="sm:hidden" />} />
      <ProfileForm
        user={{ name: user.name, email: user.email, phone: user.phone, locale: user.locale, emailNotifications: user.emailNotifications, whatsapp: !!user.whatsappOptInAt, aiConsent: user.role === "customer" ? !!user.aiConsentAt : null }}
        whatsappAvailable={whatsappAvailable}
        customerType={cust?.customer.type ?? null}
        organization={cust?.organization?.name ?? null}
      />
      <PushToggle className="mt-6 rounded-xl border border-slate-200 bg-white p-4" />
      {preview && <DeleteAccountCard email={user.email} preview={preview} className="mt-6 rounded-xl border border-red-200 bg-white p-5" />}
    </div>
  );
}
