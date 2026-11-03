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
      aria-label={`${d.lang.label}: ${d.lang.switchTo}`}
      lang={next}
    >
      <Languages className="size-4" aria-hidden />
      <span>{compact ? d.lang.switchToShort : d.lang.switchTo}</span>
    </button>
  );
}
