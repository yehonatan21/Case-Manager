/** Settings' tabs, in order; `?tab=` names one, and anything else opens General. */
export const SETTINGS_TABS = ["general", "users", "templates", "serviceTypes", "automation", "priceList", "integrations", "health"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const settingsTab = (v: string | null | undefined): SettingsTab => ((SETTINGS_TABS as readonly string[]).includes(v ?? "") ? (v as SettingsTab) : "general");
