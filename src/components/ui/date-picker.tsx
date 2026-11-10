"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { addDaysIso, addMonthsIso, clampDay, dayPresets, daysBetween, inRange, isIsoDay, monthGrid, officeTodayIso, rangePresets, sameMonth, weekdayOf } from "@/lib/calendar-days";

export type RangeContext = { from: string; to: string; part: "from" | "to"; onRange: (from: string, to: string) => void };

/**
 * The calendar the date fields open: a dialog with the month as a grid of days (Sunday first), quick picks, the
 * chosen day spelled out, and Clear. Keyboard: the arrows move between days (in reading direction), Home/End to the
 * week's start/end, PageUp/PageDown between months (with Shift, years), Enter or Space chooses, Esc closes. Beside
 * the field on a wide screen; a sheet from the bottom on a phone. In a range, the days between From and To are
 * shaded and the quick picks fill both.
 */
export function DatePickerPopover({
  anchor,
  value,
  min,
  max,
  range,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  value: string;
  min?: string;
  max?: string;
  range?: RangeContext;
  onPick: (iso: string) => void;
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}) {
  const { d, locale } = useI18n();
  const t = d.datePicker;
  const rtl = locale === "he";
  const tag = rtl ? "he-IL" : "en-GB";
  const today = officeTodayIso();
  const [focus, setFocus] = useState(() => clampDay(isIsoDay(value) ? value : today, min, max));
  const [phone, setPhone] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  const titleId = useId();
  const moved = useRef(false);

  const fmtDay = useMemo(() => new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }), [tag]);
  const fmtMonth = useMemo(() => new Intl.DateTimeFormat(tag, { timeZone: "UTC", month: "long", year: "numeric" }), [tag]);
  const fmtWeekday = useMemo(() => new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "narrow" }), [tag]);
  const fmtWeekdayLong = useMemo(() => new Intl.DateTimeFormat(tag, { timeZone: "UTC", weekday: "long" }), [tag]);
  const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const weeks = monthGrid(focus);
  // Sunday … Saturday of any week, for the column headers.
  const headers = weeks[0]!.map((iso) => ({ short: fmtWeekday.format(asDate(iso)), long: fmtWeekdayLong.format(asDate(iso)) }));

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const set = () => setPhone(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  // Beside the field: below it (or above when there's no room), aligned to its start edge, inside the screen.
  useLayoutEffect(() => {
    if (phone || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = panel.current?.offsetWidth ?? 320;
      const h = panel.current?.offsetHeight ?? 380;
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
      const start = rtl ? r.right - w : r.left;
      setPos({ top: Math.max(8, top), left: Math.min(Math.max(8, start), window.innerWidth - w - 8) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, phone, rtl]);

  // Focus goes to the chosen (or today's) day once the calendar is on screen, and follows the keyboard after that.
  const shown = phone || !!pos;
  useEffect(() => {
    if (!shown) return;
    const cell = grid.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`);
    if (cell && (moved.current || !panel.current?.contains(document.activeElement))) cell.focus();
    moved.current = false;
  }, [focus, shown]);

  // A click anywhere else closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  const go = (iso: string) => {
    moved.current = true;
    setFocus(clampDay(iso, min, max));
  };
  const pick = (iso: string) => {
    if (!inRange(iso, min, max)) return;
    onPick(iso);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const next = rtl ? -1 : 1;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => go(addDaysIso(focus, -next)),
      ArrowRight: () => go(addDaysIso(focus, next)),
      ArrowUp: () => go(addDaysIso(focus, -7)),
      ArrowDown: () => go(addDaysIso(focus, 7)),
      Home: () => go(addDaysIso(focus, -weekdayOf(focus))),
      End: () => go(addDaysIso(focus, 6 - weekdayOf(focus))),
      PageUp: () => go(addMonthsIso(focus, e.shiftKey ? -12 : -1)),
      PageDown: () => go(addMonthsIso(focus, e.shiftKey ? 12 : 1)),
      Enter: () => pick(focus),
      " ": () => pick(focus),
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };
  // Esc closes the calendar only (inside a dialog, not the dialog too).
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose({ restoreFocus: true });
    }
  };

  const relative = (iso: string) => {
    const n = daysBetween(today, iso);
    if (n === 0) return t.relToday;
    if (n === 1) return t.relTomorrow;
    if (n === -1) return t.relYesterday;
    return fmt(n > 0 ? t.relIn : t.relAgo, { n: Math.abs(n) });
  };
  const from = range?.from || "";
  const to = range?.to || "";
  const shaded = (iso: string) => !!from && !!to && iso > from && iso < to;
  const chosen = (iso: string) => (range ? iso === from || iso === to : iso === value);
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const chip = "rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-100 hover:text-brand-800 disabled:opacity-40";

  const quick = range
    ? (Object.entries(rangePresets(today)) as [keyof typeof t.ranges, { from: string; to: string }][]).map(([k, r]) => (
        <button key={k} type="button" className={chip} onClick={() => range.onRange(r.from, r.to)}>
          {t.ranges[k]}
        </button>
      ))
    : (Object.entries(dayPresets(today)) as [keyof typeof t.days, string][]).map(([k, iso]) => (
        <button key={k} type="button" className={chip} disabled={!inRange(iso, min, max)} onClick={() => pick(iso)}>
          {t.days[k]}
        </button>
      ));

  const summary = range
    ? from && to
      ? `${fmtDay.format(asDate(from)).replace(/^.*?,\s*/, "")} – ${fmtDay.format(asDate(to)).replace(/^.*?,\s*/, "")} · ${fmt(t.rangeDays, { n: daysBetween(from, to) + 1 })}`
      : t.none
    : isIsoDay(value)
      ? `${fmtDay.format(asDate(value))} · ${relative(value)}`
      : t.none;

  const body = (
    <div
      ref={panel}
      role="dialog"
      aria-modal={phone ? true : undefined}
      aria-labelledby={titleId}
      onKeyDown={onPanelKey}
      className={cn(
        "z-[70] bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-slate-200",
        phone ? "fixed inset-x-0 bottom-0 rounded-t-2xl pb-6" : "fixed w-[20rem] rounded-2xl",
        !phone && !pos && "invisible",
      )}
      style={phone ? undefined : pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0 }}
    >
      {phone && <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(addMonthsIso(focus, -1))} aria-label={t.prevMonth} className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
          <Prev className="size-4" aria-hidden />
        </button>
        <h2 id={titleId} className="text-sm font-bold" aria-live="polite">
          {fmtMonth.format(asDate(focus))}
        </h2>
        <button type="button" onClick={() => go(addMonthsIso(focus, 1))} aria-label={t.nextMonth} className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
          <Next className="size-4" aria-hidden />
        </button>
      </div>
      <table ref={grid} role="grid" aria-labelledby={titleId} className="w-full border-collapse" onKeyDown={onKey}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col" abbr={h.long} className="pb-1 text-center text-xs font-medium text-slate-500">
                {h.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((iso) => {
                const allowed = inRange(iso, min, max);
                const isChosen = chosen(iso);
                const isToday = iso === today;
                const outside = !sameMonth(iso, focus);
                return (
                  <td
                    key={iso}
                    data-day={iso}
                    tabIndex={iso === focus ? 0 : -1}
                    aria-selected={isChosen}
                    aria-disabled={!allowed || undefined}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={fmtDay.format(asDate(iso))}
                    onClick={() => (allowed ? pick(iso) : undefined)}
                    className={cn(
                      "p-0.5 text-center outline-none",
                      // The visible day is the inner circle; the cell itself carries the focus ring.
                      "[&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-brand-600 [&:focus-visible>span]:ring-offset-1",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mx-auto grid place-items-center rounded-lg text-sm tabular-nums transition-colors",
                        phone ? "size-11" : "size-9",
                        !allowed && "cursor-not-allowed text-slate-300 line-through decoration-slate-300",
                        allowed && "cursor-pointer",
                        allowed && !isChosen && !shaded(iso) && "hover:bg-slate-100",
                        allowed && outside && !isChosen && "text-slate-400",
                        allowed && !outside && !isChosen && weekdayOf(iso) === 6 && "text-slate-500",
                        shaded(iso) && "bg-brand-100 text-brand-900",
                        isChosen && "bg-brand-700 font-semibold text-white",
                        isToday && !isChosen && "font-semibold text-brand-800 ring-1 ring-inset ring-brand-500",
                      )}
                    >
                      {Number(iso.slice(8))}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div role="group" aria-label={t.quick} className="mt-3 flex flex-wrap gap-1.5">
        {quick}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="min-w-0 text-xs text-slate-600" aria-live="polite">
          {summary}
        </p>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => (range ? range.onRange("", "") : onPick(""))} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            {t.clear}
          </button>
          <button type="button" onClick={() => onClose({ restoreFocus: true })} aria-label={t.close} className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );

  return phone ? (
    <>
      <div aria-hidden className="fixed inset-0 z-[69] bg-slate-900/30" onMouseDown={() => onClose()} />
      {body}
    </>
  ) : (
    body
  );
}
