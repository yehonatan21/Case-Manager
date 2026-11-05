import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";
import { listStaff } from "@/lib/services/users";
import { listPriceList, listTemplates } from "@/lib/services/catalog";
import { PageHeader } from "@/components/ui/misc";
import { SettingsTabs } from "@/components/admin/settings/settings-tabs";
import { WhatsAppConnect } from "@/components/admin/whatsapp-connect";
import { getWhatsAppStatus } from "@/lib/services/whatsapp";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.settingsPage.title };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageStaff("/admin/settings");
  if (user.role !== "admin") redirect("/admin");
  const { tab } = await searchParams;
  const { d } = await getDict();
  const db = await getDb();
  const [settings, staff, templates, prices, whatsapp] = await Promise.all([getSettings(db), listStaff(db, { includeDisabled: true }), listTemplates(db), listPriceList(db), getWhatsAppStatus(db)]);
  return (
    <>
      <PageHeader title={d.settingsPage.title} />
      <SettingsTabs
        initialTab={tab}
        currentUserId={user.id}
        settings={settings}
        staff={staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, tasks: t.tasks, documents: t.documents, active: t.active }))}
        integrations={<WhatsAppConnect status={whatsapp} canTest={!!user.whatsappOptInAt && !!user.whatsappPhone} />}
        prices={prices.map((p) => ({ id: p.id, code: p.code, name: p.name, category: p.category, unitPriceCents: p.unitPriceCents, currency: p.currency, active: p.active }))}
      />
    </>
  );
}
