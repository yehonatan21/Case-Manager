"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { parseTheme, THEME_COLOR, THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const ICONS = { system: Monitor, light: Sun, dark: Moon };

/** Applies an appearance to the page now and remembers it for a year. */
function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  // The browser bar follows: one colour when the choice is fixed, the device's own otherwise.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const dark = theme === "system" ? (m.media || "").includes("dark") : theme === "dark";
    m.content = dark ? THEME_COLOR.dark : THEME_COLOR.light;
  });
  try {
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/** Appearance: follow the device, or always light or dark. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { d } = useI18n();
  const t = d.theme;
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(parseTheme(document.documentElement.getAttribute("data-theme"))), []);
  return (
    <section aria-labelledby="theme-title" className={className}>
      <h2 id="theme-title" className="text-base font-semibold text-slate-900">
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t.hint}</p>
      <div role="radiogroup" aria-labelledby="theme-title" className="mt-3 inline-flex max-w-full rounded-full bg-slate-100 p-1">
        {THEMES.map((v) => {
          const Icon = ICONS[v];
          const selected = v === theme;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setTheme(v);
                apply(v);
              }}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors",
                selected ? "bg-card text-slate-900 shadow-card dark:bg-slate-300" : "text-slate-600 hover:text-slate-900",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t[v]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
