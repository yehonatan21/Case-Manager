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
    <div role="tablist" aria-label={label} className={cn("no-scrollbar flex max-w-full gap-0.5 overflow-x-auto overflow-y-hidden rounded-full bg-slate-200/60 p-1", className)}>
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
            onClick={(e) => {
              onChange(t.id);
              // The bar scrolls without a visible scrollbar, so bring a partly hidden tab fully into view.
              e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              // A segmented control (segmented-controls.md): the selected segment is a raised capsule.
              "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors",
              selected ? "bg-card text-slate-900 shadow-card dark:bg-slate-300" : "text-slate-600 hover:text-slate-900",
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
