import type { Locale } from "./config";

const intlLocale = (l: Locale) => (l === "he" ? "he-IL" : "en-GB");

/**
 * All dates are shown in the business's time zone so server-rendered and hydrated output match
 * and every viewer sees the same dates. Override with NEXT_PUBLIC_TIME_ZONE.
 */
export const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "Asia/Jerusalem";

/** Date-only values (YYYY-MM-DD) are anchored at midday UTC so they never shift a day. */
const toDate = (value: Date | string) => (typeof value === "string" ? new Date(value.length === 10 ? value + "T12:00:00Z" : value) : value);

export function formatDate(value: Date | string | null | undefined, locale: Locale): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE }).format(toDate(value));
}

export function formatDateTime(value: Date | string | null | undefined, locale: Locale): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(toDate(value));
}

export function formatRelative(value: Date | string | null | undefined, locale: Locale, now = new Date()): string {
  if (!value) return "";
  const d = toDate(value);
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return formatDate(d, locale);
}

export function formatMoney(cents: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency, minimumFractionDigits: 2 }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}
