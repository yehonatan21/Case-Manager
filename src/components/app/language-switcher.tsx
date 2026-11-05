"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Switches between Hebrew (RTL) and English (LTR); persisted in a cookie and on the user profile. */
export function LanguageSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = locale === "he" ? "en" : "he";
  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }) });
          document.documentElement.lang = next;
          document.documentElement.dir = next === "he" ? "rtl" : "ltr";
          router.refresh();
        })
      }
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60",
        className,
      )}
      disabled={pending}
    >
      <Languages className="size-4" aria-hidden />
      {/* The accessible name starts with the visible text (WCAG 2.5.3), so "click English / EN" works with voice control. */}
      {compact ? (
        <span lang={next}>{d.lang.switchToShort}</span>
      ) : (
        <>
          {/* Very narrow screens (under 360px) get the short label so the header doesn't overflow (WCAG 1.4.10). */}
          <span lang={next} className="max-[359px]:hidden">
            {d.lang.switchTo}
          </span>
          <span lang={next} className="hidden max-[359px]:inline">
            {d.lang.switchToShort}
          </span>
        </>
      )}
      <span className="sr-only"> – {d.lang.label}</span>
    </button>
  );
}
