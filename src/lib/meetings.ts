/**
 * Meeting times: working hours are wall-clock times in the business time zone (Asia/Jerusalem by default), which
 * moves between UTC+2 and UTC+3. Everything is stored and compared in UTC; these helpers convert between the two
 * without a date library, using Intl.
 */
import type { WeeklyHours } from "./db/schema";

export const DEFAULT_TZ = process.env.NEXT_PUBLIC_TIME_ZONE || "Asia/Jerusalem";
export type Interval = { start: Date; end: Date };
export const SLOT_STEP_MINUTES = 30;
const MIN = 60_000;
const DAY = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, s: +p.second!, weekday };
}

/** Minutes the zone is ahead of UTC at this instant (e.g. 120 or 180 for Israel). */
export function tzOffsetMinutes(date: Date, tz = DEFAULT_TZ): number {
  const p = parts(date, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000) / MIN);
}

/** The UTC instant of a wall-clock time ("2026-11-05", "09:30") in the zone. */
export function zonedToUtc(day: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let at = new Date(guess - tzOffsetMinutes(new Date(guess), tz) * MIN);
  // Around a clock change the first guess can be an hour off; correct with the offset at the result.
  at = new Date(guess - tzOffsetMinutes(at, tz) * MIN);
  return at;
}

/** The zone's calendar day ("2026-11-05") and weekday (0 = Sunday) of an instant. */
export function zonedDay(date: Date, tz = DEFAULT_TZ): { day: string; weekday: number; time: string } {
  const p = parts(date, tz);
  return { day: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, weekday: p.weekday, time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}` };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sunday–Thursday 09:00–17:00: a common Israeli work week. */
export function defaultWeeklyHours(): WeeklyHours {
  const day = [{ start: "09:00", end: "17:00" }];
  return { "0": day, "1": day, "2": day, "3": day, "4": day, "5": [], "6": [] };
}

/** Keeps only valid, ordered, non-overlapping ranges per day. */
export function cleanWeeklyHours(input: unknown): WeeklyHours | null {
  if (!input || typeof input !== "object") return null;
  const out = {} as WeeklyHours;
  for (const k of ["0", "1", "2", "3", "4", "5", "6"] as const) {
    const ranges = (input as Record<string, unknown>)[k];
    if (ranges === undefined) {
      out[k] = [];
      continue;
    }
    if (!Array.isArray(ranges) || ranges.length > 4) return null;
    const list = ranges.map((r) => ({ start: String((r as { start?: unknown })?.start ?? ""), end: String((r as { end?: unknown })?.end ?? "") }));
    if (list.some((r) => !TIME.test(r.start) || !TIME.test(r.end) || r.start >= r.end)) return null;
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < list.length; i++) if (list[i]!.start < list[i - 1]!.end) return null;
    out[k] = list;
  }
  return out;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Free start times for a meeting of `durationMinutes`: inside the working hours, on a 30-minute grid, no earlier
 * than `earliest`, before `latest`, and clear of `busy` (other meetings, calendar events) by `bufferMinutes`.
 */
export function freeSlots(o: {
  weekly: WeeklyHours;
  durationMinutes: number;
  bufferMinutes: number;
  earliest: Date;
  latest: Date;
  busy: Interval[];
  tz?: string;
  stepMinutes?: number;
}): Date[] {
  const tz = o.tz ?? DEFAULT_TZ;
  const step = o.stepMinutes ?? SLOT_STEP_MINUTES;
  const out: Date[] = [];
  const pad = o.bufferMinutes * MIN;
  const busy = o.busy.map((b) => ({ start: new Date(b.start.getTime() - pad), end: new Date(b.end.getTime() + pad) }));
  // Walk the zone's calendar days from the earliest to the latest instant.
  const seen = new Set<string>();
  // Half-day steps so a 23- or 25-hour day around a clock change is never skipped; each day is used once.
  for (let t = o.earliest.getTime() - DAY; t <= o.latest.getTime() + DAY; t += DAY / 2) {
    const { day, weekday } = zonedDay(new Date(t), tz);
    if (seen.has(day)) continue;
    seen.add(day);
    for (const r of o.weekly[String(weekday) as keyof WeeklyHours] ?? []) {
      const rangeEnd = zonedToUtc(day, r.end, tz);
      for (let s = zonedToUtc(day, r.start, tz); s.getTime() + o.durationMinutes * MIN <= rangeEnd.getTime(); s = new Date(s.getTime() + step * MIN)) {
        const slot = { start: s, end: new Date(s.getTime() + o.durationMinutes * MIN) };
        if (slot.start < o.earliest || slot.start >= o.latest) continue;
        if (busy.some((b) => overlaps(slot, b))) continue;
        if (!out.some((x) => x.getTime() === s.getTime())) out.push(s);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines longer than 75 octets are folded, as the iCalendar format requires. */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) {
      out.push(cur);
      cur = " ";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** An .ics file for the meeting (any calendar app). The UID stays the same, and SEQUENCE grows on changes. */
export function meetingIcs(m: { id: string; startAt: Date; endAt: Date; title: string; description: string; location: string; url: string; sequence: number; cancelled: boolean; organizerName: string; host: string }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Case Manager//Meetings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${m.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${m.id}@${m.host}`,
    `SEQUENCE:${m.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.startAt)}`,
    `DTEND:${icsDate(m.endAt)}`,
    `SUMMARY:${icsText(m.title)}`,
    `DESCRIPTION:${icsText(m.description)}`,
    ...(m.location ? [`LOCATION:${icsText(m.location)}`] : []),
    `URL:${m.url}`,
    `ORGANIZER;CN=${icsText(m.organizerName)}:mailto:noreply@${m.host}`,
    `STATUS:${m.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(m.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
