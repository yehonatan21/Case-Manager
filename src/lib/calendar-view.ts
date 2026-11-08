/**
 * The Meetings page calendar: which days a day, week or month view shows, and where each event sits in a
 * day's time grid. Days are calendar days in the business time zone ("2026-11-08"); weeks start on Sunday.
 */
import { DEFAULT_TZ, zonedDay, zonedToUtc } from "./meetings";

export type CalendarMode = "day" | "week" | "month";
export const CALENDAR_MODES: CalendarMode[] = ["day", "week", "month"];

export type CalendarItem = {
  id: string;
  source: "app" | "google";
  title: string;
  /** ISO instants; for all-day events, midnight (business time) of the first day and of the day after the last. */
  start: string;
  end: string;
  allDay: boolean;
  /** A meeting's case, or the event in Google Calendar. */
  href: string | null;
  meetUrl: string | null;
  staffName: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const toUtcNoon = (day: string) => new Date(`${day}T12:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = toUtcNoon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}
export function addMonths(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return fromUtc(d);
}
/** 0 = Sunday. */
export const weekdayOf = (day: string) => toUtcNoon(day).getUTCDay();
export const startOfWeek = (day: string) => addDays(day, -weekdayOf(day));
export const todayIn = (tz = DEFAULT_TZ, now = new Date()) => zonedDay(now, tz).day;

export function parseMode(v: string | undefined): CalendarMode {
  return CALENDAR_MODES.includes(v as CalendarMode) ? (v as CalendarMode) : "week";
}
export function parseDay(v: string | undefined, tz = DEFAULT_TZ): string {
  if (v && DAY_RE.test(v) && fromUtc(toUtcNoon(v)) === v) return v;
  return todayIn(tz);
}

export type CalendarRange = {
  mode: CalendarMode;
  anchor: string;
  /** The days shown, in order (a month view shows whole weeks). */
  days: string[];
  from: Date;
  to: Date;
  prev: string;
  next: string;
};

export function calendarRange(mode: CalendarMode, anchor: string, tz = DEFAULT_TZ): CalendarRange {
  let first: string;
  let count: number;
  let prev: string;
  let next: string;
  if (mode === "day") {
    first = anchor;
    count = 1;
    prev = addDays(anchor, -1);
    next = addDays(anchor, 1);
  } else if (mode === "week") {
    first = startOfWeek(anchor);
    count = 7;
    prev = addDays(anchor, -7);
    next = addDays(anchor, 7);
  } else {
    const monthStart = `${anchor.slice(0, 7)}-01`;
    const monthEnd = addDays(addMonths(monthStart, 1), -1);
    first = startOfWeek(monthStart);
    const last = addDays(startOfWeek(monthEnd), 6);
    count = Math.round((toUtcNoon(last).getTime() - toUtcNoon(first).getTime()) / 86_400_000) + 1;
    prev = addMonths(monthStart, -1);
    next = addMonths(monthStart, 1);
  }
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return { mode, anchor, days, from: zonedToUtc(days[0]!, "00:00", tz), to: zonedToUtc(addDays(days.at(-1)!, 1), "00:00", tz), prev, next };
}

/** The items that fall on a day (an item running past midnight appears on each day it touches). */
export function itemsOnDay(items: CalendarItem[], day: string, tz = DEFAULT_TZ): CalendarItem[] {
  const from = zonedToUtc(day, "00:00", tz).getTime();
  const to = zonedToUtc(addDays(day, 1), "00:00", tz).getTime();
  return items
    .filter((i) => new Date(i.start).getTime() < to && new Date(i.end).getTime() > from)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

export type PlacedItem = { item: CalendarItem; startMin: number; endMin: number; lane: number; lanes: number };

/**
 * A day's timed items in the time grid: minutes from midnight (clipped to the day), and side-by-side lanes
 * for items that overlap.
 */
export function placeDay(items: CalendarItem[], day: string, tz = DEFAULT_TZ): PlacedItem[] {
  const from = zonedToUtc(day, "00:00", tz).getTime();
  const to = zonedToUtc(addDays(day, 1), "00:00", tz).getTime();
  const len = (to - from) / 60_000;
  const placed = itemsOnDay(items, day, tz)
    .filter((i) => !i.allDay)
    .map((item) => {
      const startMin = Math.max(0, Math.round((new Date(item.start).getTime() - from) / 60_000));
      // At least 20 minutes tall, so a short item stays readable.
      const endMin = Math.min(len, Math.max(startMin + 20, Math.round((new Date(item.end).getTime() - from) / 60_000)));
      return { item, startMin, endMin, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  // Groups of items that overlap each other; within a group, each item takes the first free lane.
  let group: PlacedItem[] = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = lanes;
    group = [];
  };
  for (const p of placed) {
    if (p.startMin >= groupEnd) {
      close();
      groupEnd = -1;
    }
    const laneEnds: number[] = [];
    for (const g of group) laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? 0, g.endMin);
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane]! > p.startMin) lane++;
    p.lane = lane;
    group.push(p);
    groupEnd = Math.max(groupEnd, p.endMin);
  }
  close();
  return placed;
}

/** The hours the time grid shows: 08:00–20:00, widened to fit every timed item in the range. */
export function gridHours(placedByDay: PlacedItem[][]): { first: number; last: number } {
  let first = 8;
  let last = 20;
  for (const day of placedByDay)
    for (const p of day) {
      first = Math.min(first, Math.floor(p.startMin / 60));
      last = Math.max(last, Math.ceil(p.endMin / 60));
    }
  return { first, last: Math.min(24, last) };
}
