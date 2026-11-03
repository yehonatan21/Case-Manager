"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./config";
import { dictionaries, type Dict } from "./dictionaries";

const I18nContext = createContext<{ locale: Locale; d: Dict }>({ locale: "he", d: dictionaries.he });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, d: dictionaries[locale] }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
