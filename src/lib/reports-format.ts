/** Shared labels and number formats for the reports page and its Excel export. */
import type { Locale } from "./i18n/config";

export const intlLocale = (l: Locale) => (l === "he" ? "he-IL" : "en-GB");
export const monthLabel = (month: string, l: Locale, withYear = true) =>
  new Intl.DateTimeFormat(intlLocale(l), { month: "short", ...(withYear ? { year: "2-digit" } : {}), timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
export const pct = (x: number | null, l: Locale) => (x === null ? "—" : new Intl.NumberFormat(intlLocale(l), { style: "percent", maximumFractionDigits: 0 }).format(x));
export const num = (x: number | null, l: Locale, digits = 0) => (x === null ? "—" : new Intl.NumberFormat(intlLocale(l), { maximumFractionDigits: digits }).format(x));
/** Hours as "5 h" under two days, else days. */
export function duration(hours: number | null, l: Locale, t: { hours: string; days: string }) {
  if (hours === null) return "—";
  if (hours < 48) return t.hours.replace("{n}", num(hours, l, hours < 10 ? 1 : 0));
  return t.days.replace("{n}", num(hours / 24, l, 1));
}

/** Minutes as hours and minutes: "2:05". */
export function hhmm(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
