"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import { dictFor, dictionaries, type Dict } from "./dictionaries";

const I18nContext = createContext<{ locale: Locale; d: Dict }>({ locale: "he", d: dictionaries.he });

/** `aiMayKeepData`: the AI provider may keep prompts (free models), so the AI texts say so. */
export function I18nProvider({ locale, aiMayKeepData = false, children }: { locale: Locale; aiMayKeepData?: boolean; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, d: dictFor(locale, { aiMayKeepData }) }), [locale, aiMayKeepData]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
