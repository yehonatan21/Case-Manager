/**
 * Plain date arithmetic for the date picker, on YYYY-MM-DD strings (no time zones involved: a day is a day).
 * Weeks start on Sunday, as in Israel.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fromDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const isIsoDay = (s: string | null | undefined): s is string => !!s && ISO.test(s) && fromDate(toDate(s)) === s;

export function addDaysIso(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** The same day n months later (or earlier); the 31st becomes the month's last day when it has none. */
export function addMonthsIso(iso: string, n: number): string {
  const [y, m, day] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fromDate(target);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (iso: string) => toDate(iso).getUTCDay();
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export const monthEnd = (iso: string) => addDaysIso(addMonthsIso(monthStart(iso), 1), -1);
export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** The weeks shown for a month: Sunday to Saturday, including the days of the neighbouring months that fill them. */
export function monthGrid(iso: string): string[][] {
  const first = monthStart(iso);
  let day = addDaysIso(first, -weekdayOf(first));
  const last = monthEnd(iso);
  const weeks: string[][] = [];
  while (day <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDaysIso(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Keeps a day inside [min, max] (either may be missing). */
export function clampDay(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export const inRange = (iso: string, min?: string, max?: string) => (!min || iso >= min) && (!max || iso <= max);

/** Whole days from a to b (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);

/** Today in the office's time zone, as YYYY-MM-DD. */
export function officeTodayIso(now = new Date(), timeZone = "Asia/Jerusalem"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Ready-made ranges for list filters, ending today. */
export function rangePresets(today: string): Record<"last7" | "thisMonth" | "lastMonth" | "thisYear", { from: string; to: string }> {
  const lastMonthDay = addMonthsIso(monthStart(today), -1);
  return {
    last7: { from: addDaysIso(today, -6), to: today },
    thisMonth: { from: monthStart(today), to: today },
    lastMonth: { from: lastMonthDay, to: monthEnd(lastMonthDay) },
    thisYear: { from: `${today.slice(0, 4)}-01-01`, to: today },
  };
}

/** Ready-made single days, from today. */
export function dayPresets(today: string): Record<"today" | "tomorrow" | "nextWeek" | "nextMonth", string> {
  return { today, tomorrow: addDaysIso(today, 1), nextWeek: addDaysIso(today, 7), nextMonth: addMonthsIso(today, 1) };
}
