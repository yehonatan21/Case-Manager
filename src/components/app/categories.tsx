"use client";

import { createContext, useContext, useMemo } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { CategoryInfo } from "@/lib/services/categories";

const Ctx = createContext<CategoryInfo[]>([]);

/** Service types (built-in and custom), loaded once in the root layout. */
export function CategoriesProvider({ categories, children }: { categories: CategoryInfo[]; children: React.ReactNode }) {
  return <Ctx.Provider value={categories}>{children}</Ctx.Provider>;
}

/** Active service types for pickers, and a label for any key (hidden or unknown types fall back gracefully). */
export function useCategories() {
  const all = useContext(Ctx);
  const { d, locale } = useI18n();
  return useMemo(() => {
    const byKey = new Map(all.map((c) => [c.key, c]));
    const label = (key: string | null | undefined) => {
      const c = key ? byKey.get(key) : undefined;
      if (c) return locale === "he" ? c.he : c.en;
      return (d.categories as Record<string, string>)[key ?? ""] ?? d.categories.other;
    };
    return { list: all.filter((c) => c.active), label };
  }, [all, d, locale]);
}
