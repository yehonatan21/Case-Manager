"use client";

import { useI18n } from "@/lib/i18n/client";
import { formatDateTime, formatRelative } from "@/lib/i18n/format";

/** "5 minutes ago" — computed at render time, so hydration differences are expected and suppressed. */
export function RelativeTime({ value, className }: { value: Date | string; className?: string }) {
  const { locale } = useI18n();
  const d = new Date(value);
  return (
    <time dateTime={d.toISOString()} title={formatDateTime(d, locale)} className={className} suppressHydrationWarning>
      {formatRelative(d, locale)}
    </time>
  );
}
