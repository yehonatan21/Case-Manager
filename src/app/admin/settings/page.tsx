import { getDict } from "@/lib/i18n/server";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { getSettings } from "@/lib/services/settings";
import { listStaff } from "@/lib/services/users";
import { listPriceList, listTemplates } from "@/lib/services/catalog";
import { PageHeader } from "@/components/ui/misc";
import { SettingsShell } from "@/components/admin/settings/settings-shell";
import { GeneralSettings } from "@/components/admin/settings/general-settings";
import { UsersSettings } from "@/components/admin/settings/users-settings";
import { TemplatesSettings } from "@/components/admin/settings/templates-settings";
import { PriceListSettings } from "@/components/admin/settings/price-list-settings";
import { WhatsAppConnect } from "@/components/admin/whatsapp-connect";
import { getWhatsAppStatus } from "@/lib/services/whatsapp";
import { GrowConnect } from "@/components/admin/grow-connect";
import { ServiceTypes } from "@/components/admin/settings/service-types";
import { CalendarConnect } from "@/components/admin/meetings/calendar-connect";
import { InvoicesConnect } from "@/components/admin/invoices-connect";
import { getInvoiceStatus } from "@/lib/services/invoices";
import { EmailConnect } from "@/components/admin/email-connect";
import { getEmailStatus } from "@/lib/services/email";
import { getCalendarStatus } from "@/lib/services/calendar";
import { googleEnabled } from "@/lib/services/google";
import { listServiceCategories } from "@/lib/services/categories";
import { getPaymentProviderStatus } from "@/lib/services/payment-settings";
import { listRules } from "@/lib/services/automation";
import { getSystemHealth } from "@/lib/services/health";
import { HealthView } from "@/components/admin/health/health-view";
import { ErrorsList } from "@/components/admin/health/errors-list";
import { listErrors } from "@/lib/services/error-tracking";
import { RulesEditor } from "@/components/admin/automation/rules-editor";
import { settingsTab, type SettingsTab } from "@/config/settings-tabs";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.settingsPage.title };
}

/** Settings (admins). Only the open tab's data is loaded; the other tabs load when they're opened. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; calendar?: string }> }) {
  const user = await requireStaffPage("/admin/settings", "settings");
  const sp = await searchParams;
  const tab = settingsTab(sp.tab);
  const { d } = await getDict();
  return (
    <>
      <PageHeader title={d.settingsPage.title} />
      <SettingsShell tab={tab}>
        <TabContent tab={tab} user={user} calendarResult={sp.calendar} />
      </SettingsShell>
    </>
  );
}

async function TabContent({ tab, user, calendarResult }: { tab: SettingsTab; user: User; calendarResult?: string }) {
  const db = await getDb();
  const { d } = await getDict();
  switch (tab) {
    case "general":
      return <GeneralSettings settings={await getSettings(db)} />;
    case "users": {
      const staff = await listStaff(db, { includeDisabled: true });
      return (
        <UsersSettings
          currentUserId={user.id}
          staff={staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status, hourlyCostCents: s.hourlyCostCents, twoFactor: !!s.totpEnabledAt }))}
        />
      );
    }
    case "templates": {
      const templates = await listTemplates(db);
      return (
        <TemplatesSettings
          templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, tasks: t.tasks, stages: t.stages, documents: t.documents, active: t.active }))}
        />
      );
    }
    case "serviceTypes":
      return (
        <div className="max-w-3xl">
          <ServiceTypes categories={await listServiceCategories(db, { includeInactive: true })} />
        </div>
      );
    case "automation": {
      const rules = await listRules(db);
      return (
        <div className="max-w-4xl">
          <RulesEditor
            rules={rules.map((r) => ({
              id: r.id,
              name: r.name,
              active: r.active,
              trigger: r.trigger,
              triggerStatus: r.triggerStatus,
              category: r.category,
              action: r.action,
              runCount: r.runCount,
              lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
            }))}
          />
        </div>
      );
    }
    case "priceList": {
      const [prices, settings] = await Promise.all([listPriceList(db), getSettings(db)]);
      return (
        <PriceListSettings
          currency={settings.currency}
          prices={prices.map((p) => ({ id: p.id, code: p.code, name: p.name, category: p.category, unitPriceCents: p.unitPriceCents, currency: p.currency, active: p.active }))}
        />
      );
    }
    case "integrations": {
      const [email, payments, invoices, whatsapp, calendar] = await Promise.all([
        getEmailStatus(db),
        getPaymentProviderStatus(db),
        getInvoiceStatus(db),
        getWhatsAppStatus(db),
        getCalendarStatus(db, user.id),
      ]);
      return (
        <div className="max-w-3xl space-y-4">
          <EmailConnect status={email} adminEmail={user.email} />
          <GrowConnect status={payments} canEdit className="" />
          <InvoicesConnect status={invoices} />
          <WhatsAppConnect status={whatsapp} canTest={!!user.whatsappOptInAt && !!user.whatsappPhone} />
          <CalendarConnect status={calendar} available={googleEnabled()} result={calendarResult} returnTo="/admin/settings?tab=integrations" />
        </div>
      );
    }
    case "health": {
      const [health, errors] = await Promise.all([getSystemHealth(db, user), listErrors(db, user)]);
      return (
        <div className="max-w-5xl">
          <h2 className="text-lg font-semibold">{d.health.title}</h2>
          <p className="mb-4 text-sm text-slate-500">{d.health.subtitle}</p>
          <HealthView level={health.level} checks={health.checks} checkedAt={health.checkedAt} />
          <ErrorsList
            errors={errors.map((e) => ({
              id: e.id,
              source: e.source,
              message: e.message,
              stack: e.stack,
              path: e.path,
              count: e.count,
              firstSeenAt: e.firstSeenAt.toISOString(),
              lastSeenAt: e.lastSeenAt.toISOString(),
            }))}
          />
        </div>
      );
    }
  }
}
