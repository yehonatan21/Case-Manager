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
import { GrowConnect } from "@/components/admin/grow-connect";
import { ServiceTypes } from "@/components/admin/settings/service-types";
import { CalendarConnect } from "@/components/admin/meetings/calendar-connect";
import { InvoicesConnect } from "@/components/admin/invoices-connect";
import { getInvoiceStatus } from "@/lib/services/invoices";
import { getCalendarStatus } from "@/lib/services/calendar";
import { googleEnabled } from "@/lib/services/google";
import { listServiceCategories } from "@/lib/services/categories";
import { getPaymentProviderStatus } from "@/lib/services/payment-settings";
import { listRules } from "@/lib/services/automation";
import { RulesEditor } from "@/components/admin/automation/rules-editor";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.settingsPage.title };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; calendar?: string }> }) {
  const user = await requirePageStaff("/admin/settings");
  if (user.role !== "admin") redirect("/admin");
  const { tab, calendar } = await searchParams;
  const { d } = await getDict();
  const db = await getDb();
  const [settings, staff, templates, prices, whatsapp, payments] = await Promise.all([
    getSettings(db),
    listStaff(db, { includeDisabled: true }),
    listTemplates(db),
    listPriceList(db),
    getWhatsAppStatus(db),
    getPaymentProviderStatus(db),
  ]);
  const rules = await listRules(db);
  const [categories, calendarStatus, invoiceStatus] = await Promise.all([listServiceCategories(db, { includeInactive: true }), getCalendarStatus(db, user.id), getInvoiceStatus(db)]);
  return (
    <>
      <PageHeader title={d.settingsPage.title} />
      <SettingsTabs
        initialTab={tab}
        currentUserId={user.id}
        settings={settings}
        staff={staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, tasks: t.tasks, stages: t.stages, documents: t.documents, active: t.active }))}
        serviceTypes={<ServiceTypes categories={categories} />}
        automation={<RulesEditor rules={rules.map((r) => ({ id: r.id, name: r.name, active: r.active, trigger: r.trigger, triggerStatus: r.triggerStatus, category: r.category, action: r.action, runCount: r.runCount, lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null }))} />}
        integrations={
          <>
            <GrowConnect status={payments} canEdit className="" />
            <InvoicesConnect status={invoiceStatus} />
            <WhatsAppConnect status={whatsapp} canTest={!!user.whatsappOptInAt && !!user.whatsappPhone} />
            <CalendarConnect status={calendarStatus} available={googleEnabled()} result={calendar} returnTo="/admin/settings?tab=integrations" />
          </>
        }
        prices={prices.map((p) => ({ id: p.id, code: p.code, name: p.name, category: p.category, unitPriceCents: p.unitPriceCents, currency: p.currency, active: p.active }))}
      />
    </>
  );
}
