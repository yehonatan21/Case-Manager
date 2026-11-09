/**
 * Shared pieces for the staff lists that are searched, filtered and paged on the server (Quotes, Payments, Tasks):
 * reading the URL's values safely, date ranges in the office's time zone, and the paging numbers.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { zonedToUtc } from "../meetings";
import { addDays } from "../calendar-view";

export const LIST_PAGE_SIZE = 50;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export const isDay = (s: string | undefined): s is string => !!s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
export const isUuid = (s: string | undefined): s is string => !!s && UUID.test(s);

/** The value if it is one of the allowed ones, otherwise undefined (an unknown value in the URL is ignored). */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** A search term from the URL: trimmed and capped, or undefined when empty. */
export const searchTerm = (q: string | undefined) => q?.trim().slice(0, 100) || undefined;

/** "From" and "to" days (YYYY-MM-DD, both included) on a timestamp column, in the office's time zone. */
export function dayRange(column: AnyColumn | SQL, from?: string, to?: string): SQL[] {
  const parts: SQL[] = [];
  if (isDay(from)) parts.push(sql`${column} >= ${zonedToUtc(from, "00:00").toISOString()}`);
  if (isDay(to)) parts.push(sql`${column} < ${zonedToUtc(addDays(to, 1), "00:00").toISOString()}`);
  return parts;
}

/** An amount typed in whole currency units ("150" or "149.90") → cents; undefined when it isn't a number. */
export function toCents(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

export function pageNumber(page: number | undefined): number {
  return Math.max(1, Math.floor(Number(page) || 1));
}

/** The paging numbers every list returns with its rows. */
export function paged<R>(rows: R[], total: number, page: number, pageSize = LIST_PAGE_SIZE) {
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
