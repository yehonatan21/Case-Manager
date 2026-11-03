"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

export type TabItem = { id: string; label: React.ReactNode; badge?: React.ReactNode };

/** Accessible tab list (arrow keys follow reading direction). Panels are rendered by the parent. */
export function TabList({ tabs, value, onChange, className, label }: { tabs: TabItem[]; value: string; onChange: (id: string) => void; className?: string; label?: string }) {
  const { locale } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const fwd = locale === "he" ? "ArrowLeft" : "ArrowRight";
    const back = locale === "he" ? "ArrowRight" : "ArrowLeft";
    let n = -1;
    if (e.key === fwd) n = (i + 1) % tabs.length;
    if (e.key === back) n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = tabs.length - 1;
    if (n >= 0) {
      e.preventDefault();
      onChange(tabs[n]!.id);
      refs.current[n]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-slate-200", className)}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm font-medium transition-colors",
              selected ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, children, className }: { id: string; active: boolean; children: React.ReactNode; className?: string }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={className}>
      {children}
    </div>
  );
}
