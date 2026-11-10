"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { TabList } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/misc";
import { SETTINGS_TABS, settingsTab, type SettingsTab } from "@/config/settings-tabs";

/**
 * Settings' tabs. Only the open tab is loaded: choosing another one asks the server for that tab (`?tab=…`, so a
 * reload, a shared link and Back/Forward all open it), and shows it as loading until it arrives.
 */
export function SettingsShell({ tab, children }: { tab: SettingsTab; children: React.ReactNode }) {
  const { d } = useI18n();
  const router = useRouter();
  const [, start] = useTransition();
  // The tab the person chose (or Back/Forward went to), shown as selected straight away while its content loads.
  const urlTab = settingsTab(useSearchParams().get("tab"));
  const [chosen, setChosen] = useState<SettingsTab>(tab);
  useEffect(() => setChosen(urlTab), [urlTab]);
  const labels: Record<SettingsTab, string> = {
    general: d.settingsPage.tabs.general,
    users: d.settingsPage.tabs.users,
    templates: d.settingsPage.tabs.templates,
    serviceTypes: d.settingsPage.tabs.serviceTypes,
    automation: d.automation.tab,
    priceList: d.settingsPage.tabs.priceList,
    integrations: d.settingsPage.tabs.integrations,
    health: d.health.title,
  };
  const choose = (id: string) => {
    if (id === chosen) return;
    setChosen(id as SettingsTab);
    start(() => router.push(`/admin/settings?tab=${id}`, { scroll: false }));
  };
  const loading = chosen !== tab;
  return (
    <div>
      <TabList value={chosen} onChange={choose} label={d.settingsPage.title} tabs={SETTINGS_TABS.map((id) => ({ id, label: labels[id] }))} />
      <div className="pt-5">
        {loading ? (
          <div role="tabpanel" id={`panel-${chosen}`} aria-labelledby={`tab-${chosen}`} aria-busy="true" className="py-10">
            <Spinner label={d.common.loading} />
          </div>
        ) : (
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
