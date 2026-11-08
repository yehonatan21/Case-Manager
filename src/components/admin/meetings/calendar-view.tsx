import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Dict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/config";
import { TIME_ZONE } from "@/lib/i18n/format";
import { CALENDAR_MODES, gridHours, itemsOnDay, placeDay, todayIn, type CalendarItem, type CalendarMode, type CalendarRange, type PlacedItem } from "@/lib/calendar-view";
import { zonedDay } from "@/lib/meetings";
import { cn } from "@/lib/utils";

/**
 * The Meetings page calendar: a day or week time grid, or a month grid, of the app's meetings and the
 * team member's Google Calendar events. Rendered on the server; moving and switching views are links.
 */
const HOUR_PX = 48;
const MONTH_CELL_ITEMS = 3;

type T = Dict["meetings"]["cal"];

const intl = (l: Locale) => (l === "he" ? "he-IL" : "en-GB");
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

export function CalendarView(props: { range: CalendarRange; items: CalendarItem[]; google: "ok" | "off" | "error"; locale: Locale; t: T; all: boolean; now?: Date }) {
  const { range, items, google, locale, t, all } = props;
  const now = props.now ?? new Date();
  const today = todayIn(TIME_ZONE, now);
  const href = (mode: CalendarMode, date: string) => `/admin/meetings?${new URLSearchParams({ view: mode, date, ...(all ? { all: "1" } : {}) })}#calendar`;
  const label = rangeLabel(range, locale);
  const prevNext = { day: [t.prevDay, t.nextDay], week: [t.prevWeek, t.nextWeek], month: [t.prevMonth, t.nextMonth] }[range.mode];
  // The arrows point the way time runs in the page's direction.
  const [Back, Forward] = locale === "he" ? [ChevronRight, ChevronLeft] : [ChevronLeft, ChevronRight];

  return (
    <section id="calendar" aria-labelledby="calendar-title" className="min-w-0 scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="calendar-title" className="text-lg font-semibold">
          {t.title}
        </h2>
        <nav aria-label={t.navLabel} className="flex items-center gap-1">
          <Link href={href(range.mode, range.prev)} aria-label={prevNext[0]} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100">
            <Back className="size-5" aria-hidden />
          </Link>
          <Link href={href(range.mode, today)} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {t.today}
          </Link>
          <Link href={href(range.mode, range.next)} aria-label={prevNext[1]} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100">
            <Forward className="size-5" aria-hidden />
          </Link>
        </nav>
        <p className="font-medium text-slate-800" aria-live="polite">
          {label}
        </p>
        <nav aria-label={t.viewLabel} className="ms-auto flex rounded-lg border border-slate-300 p-0.5 text-sm">
          {CALENDAR_MODES.map((m) => (
            <Link
              key={m}
              href={href(m, range.anchor)}
              aria-current={m === range.mode ? "page" : undefined}
              className={cn("rounded-md px-3 py-1", m === range.mode ? "bg-brand-700 font-medium text-white" : "text-slate-700 hover:bg-slate-100")}
            >
              {t[m]}
            </Link>
          ))}
        </nav>
      </div>

      {google !== "ok" && <p className="mb-2 text-sm text-slate-600">{google === "error" ? t.googleError : t.googleOff}</p>}

      {range.mode === "month" ? (
        <MonthGrid range={range} items={items} locale={locale} t={t} today={today} dayHref={(d) => href("day", d)} />
      ) : (
        <TimeGrid range={range} items={items} locale={locale} t={t} today={today} now={now} dayHref={(d) => href("day", d)} />
      )}

      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600" aria-label={t.title}>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm border border-brand-300 bg-brand-50" />
          {t.legendMeeting}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm border border-emerald-400 bg-emerald-50" />
          {t.legendGoogle}
        </li>
      </ul>
    </section>
  );
}

function rangeLabel(range: CalendarRange, locale: Locale) {
  const f = (o: Intl.DateTimeFormatOptions, day: string) => new Intl.DateTimeFormat(intl(locale), { ...o, timeZone: "UTC" }).format(atNoon(day));
  if (range.mode === "day") return f({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, range.anchor);
  if (range.mode === "month") return f({ month: "long", year: "numeric" }, range.anchor);
  const first = range.days[0]!;
  const last = range.days.at(-1)!;
  return `${f({ day: "numeric", month: "short" }, first)} – ${f({ day: "numeric", month: "short", year: "numeric" }, last)}`;
}

const timeOf = (iso: string, locale: Locale) => new Intl.DateTimeFormat(intl(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).format(new Date(iso));

function ItemLink({ item, locale, t, className, style, compact }: { item: CalendarItem; locale: Locale; t: T; className?: string; style?: React.CSSProperties; compact?: boolean }) {
  const google = item.source === "google";
  const title = item.title || t.noTitle;
  const time = item.allDay ? t.allDay : `${timeOf(item.start, locale)}–${timeOf(item.end, locale)}`;
  const body = (
    <>
      <span className={cn("block truncate font-medium", compact && "inline")}>{compact && !item.allDay ? `${timeOf(item.start, locale)} ` : ""}{title}</span>
      {!compact && <span className="block truncate text-[11px] opacity-90">{time}{item.staffName ? ` · ${item.staffName}` : ""}</span>}
      {google && <span className="sr-only"> ({t.legendGoogle}, {t.openInGoogle})</span>}
      {compact && <span className="sr-only">, {time}</span>}
    </>
  );
  const cls = cn(
    "block overflow-hidden rounded-md border px-1.5 py-0.5 text-xs leading-tight bidi-auto",
    google ? "border-emerald-400 bg-emerald-50 text-emerald-950 hover:bg-emerald-100" : "border-brand-300 bg-brand-50 text-brand-900 hover:bg-brand-100",
    className,
  );
  if (!item.href) return <span className={cls} style={style}>{body}</span>;
  if (google)
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
        {body}
      </a>
    );
  return (
    <Link href={item.href} className={cls} style={style}>
      {body}
    </Link>
  );
}

function DayHeader({ day, locale, today, href, long }: { day: string; locale: Locale; today: string; href: string; long?: boolean }) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intl(locale), { ...o, timeZone: "UTC" }).format(atNoon(day));
  const isToday = day === today;
  return (
    <Link href={href} aria-current={isToday ? "date" : undefined} className="flex flex-col items-center py-1 text-slate-600 hover:text-slate-900">
      <span className="text-xs">{f({ weekday: long ? "long" : "short" })}</span>
      <span className={cn("grid size-8 place-items-center rounded-full text-base font-semibold", isToday ? "bg-brand-700 text-white" : "text-slate-900")}>{f({ day: "numeric" })}</span>
      <span className="sr-only">{f({ month: "long" })}</span>
    </Link>
  );
}

function TimeGrid({ range, items, locale, t, today, now, dayHref }: { range: CalendarRange; items: CalendarItem[]; locale: Locale; t: T; today: string; now: Date; dayHref: (d: string) => string }) {
  const placed = range.days.map((d) => placeDay(items, d, TIME_ZONE));
  const allDay = range.days.map((d) => itemsOnDay(items, d, TIME_ZONE).filter((i) => i.allDay));
  const { first, last } = gridHours(placed);
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const height = hours.length * HOUR_PX;
  const cols = { gridTemplateColumns: `3.25rem repeat(${range.days.length}, minmax(0, 1fr))` };
  const nowMin = (() => {
    const z = zonedDay(now, TIME_ZONE);
    const [h, m] = z.time.split(":").map(Number) as [number, number];
    return h * 60 + m;
  })();
  const hasAllDay = allDay.some((a) => a.length > 0);
  const empty = placed.every((p) => p.length === 0) && !hasAllDay;
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className={cn(range.days.length > 1 && "min-w-[42rem]")}>
        <div className="grid border-b border-slate-200" style={cols}>
          <div />
          {range.days.map((d) => (
            <DayHeader key={d} day={d} locale={locale} today={today} href={dayHref(d)} long={range.days.length === 1} />
          ))}
        </div>
        {hasAllDay && (
          <div className="grid border-b border-slate-200" style={cols}>
            <div className="px-1 py-1 text-end text-[11px] text-slate-600">{t.allDay}</div>
            {allDay.map((list, i) => (
              <ul key={range.days[i]} className="min-w-0 space-y-0.5 border-s border-slate-100 p-0.5">
                {list.map((item) => (
                  <li key={item.id}>
                    <ItemLink item={item} locale={locale} t={t} compact />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        )}
        <div className="relative grid" style={cols}>
          <div aria-hidden className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <span key={h} className="absolute end-1.5 -translate-y-1/2 text-[11px] text-slate-600" style={{ top: i * HOUR_PX }}>
                {i === 0 ? "" : hourLabel(h)}
              </span>
            ))}
          </div>
          {range.days.map((d, di) => (
            <div
              key={d}
              className="relative border-s border-slate-100"
              style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgb(241 245 249) ${HOUR_PX - 1}px, rgb(241 245 249) ${HOUR_PX}px)` }}
            >
              <ol className="contents">
                {placed[di]!.map((p) => (
                  <li key={p.item.id} className="contents">
                    <ItemLink item={p.item} locale={locale} t={t} className="absolute z-10 shadow-sm" style={position(p, first)} compact={p.endMin - p.startMin < 40} />
                  </li>
                ))}
              </ol>
              {d === today && nowMin >= first * 60 && nowMin <= last * 60 && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: ((nowMin - first * 60) / 60) * HOUR_PX }}>
                  <span className="absolute -start-1 -top-[5px] size-2 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          ))}
          {empty && <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm text-slate-600">{t.empty}</p>}
        </div>
      </div>
    </div>
  );
}

function position(p: PlacedItem, firstHour: number): React.CSSProperties {
  const width = 100 / p.lanes;
  return {
    top: ((p.startMin - firstHour * 60) / 60) * HOUR_PX,
    height: Math.max(18, ((p.endMin - p.startMin) / 60) * HOUR_PX - 2),
    insetInlineStart: `calc(${p.lane * width}% + 2px)`,
    width: `calc(${width}% - 4px)`,
  };
}

function MonthGrid({ range, items, locale, t, today, dayHref }: { range: CalendarRange; items: CalendarItem[]; locale: Locale; t: T; today: string; dayHref: (d: string) => string }) {
  const month = range.anchor.slice(0, 7);
  const weeks: string[][] = [];
  for (let i = 0; i < range.days.length; i += 7) weeks.push(range.days.slice(i, i + 7));
  const weekday = (day: string, style: "short" | "long") => new Intl.DateTimeFormat(intl(locale), { weekday: style, timeZone: "UTC" }).format(atNoon(day));
  const fullDate = (day: string) => new Intl.DateTimeFormat(intl(locale), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(atNoon(day));
  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[42rem] table-fixed border-collapse">
        <thead>
          <tr>
            {weeks[0]!.map((d) => (
              <th key={d} scope="col" className="border-b border-slate-200 py-1.5 text-xs font-medium text-slate-600">
                <abbr title={weekday(d, "long")} className="no-underline">
                  {weekday(d, "short")}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w[0]}>
              {w.map((d) => {
                const list = itemsOnDay(items, d, TIME_ZONE);
                const inMonth = d.startsWith(month);
                const extra = list.length - MONTH_CELL_ITEMS;
                return (
                  <td key={d} className={cn("h-28 border border-slate-100 p-1 align-top", !inMonth && "bg-slate-50")}>
                    <Link
                      href={dayHref(d)}
                      aria-label={fullDate(d)}
                      aria-current={d === today ? "date" : undefined}
                      className={cn("mb-0.5 grid size-6 place-items-center rounded-full text-xs font-semibold", d === today ? "bg-brand-700 text-white" : inMonth ? "text-slate-900 hover:bg-slate-100" : "text-slate-500 hover:bg-slate-100")}
                    >
                      {Number(d.slice(8))}
                    </Link>
                    <ul className="space-y-0.5">
                      {list.slice(0, MONTH_CELL_ITEMS).map((item) => (
                        <li key={item.id}>
                          <ItemLink item={item} locale={locale} t={t} compact />
                        </li>
                      ))}
                    </ul>
                    {extra > 0 && (
                      <Link href={dayHref(d)} className="mt-0.5 block px-1 text-[11px] font-medium text-slate-700 hover:underline">
                        {fmt(t.more, { n: extra })}
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

