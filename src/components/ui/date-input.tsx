"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { fieldBase } from "./form";
import { DatePickerPopover } from "./date-picker";

/**
 * A date field that always reads and writes DD/MM/YYYY, whatever the browser's language (the browser's own date
 * field follows the browser's settings, which shows MM/DD/YYYY in a US-English browser). The value it reports is
 * YYYY-MM-DD, or "" while the date is empty or incomplete. The calendar button opens the app's calendar (the
 * same one everywhere, Sunday first, with quick picks). With `name`, the YYYY-MM-DD value is also sent with a plain
 * form. Two fields with the same `range.group` (one `part: "from"`, one `"to"`) work as a range: the calendar shades
 * the days between them and its quick picks ("last 7 days", "this month"…) fill both.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "min" | "max"> & {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  min?: string;
  max?: string;
  range?: { group: string; part: "from" | "to" };
};

// ---- Range groups: the From and To fields of one filter, kept in step (they may be server-rendered apart) ----
type Group = { from: string; to: string; listeners: Set<() => void>; set: Set<(from: string, to: string) => void> };
const groups = new Map<string, Group>();
const groupOf = (id: string) => {
  let g = groups.get(id);
  if (!g) groups.set(id, (g = { from: "", to: "", listeners: new Set(), set: new Set() }));
  return g;
};
const notify = (g: Group) => g.listeners.forEach((l) => l());

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-08" → "08/11/2026". */
export function isoToDisplay(iso: string | null | undefined): string {
  const m = iso ? ISO.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "08/11/2026" (or "8/11/2026", or an ISO date) → "2026-11-08"; "" when it isn't a real, complete date. */
export function displayToIso(text: string): string {
  const t = text.trim();
  if (ISO.test(t)) return validIso(t);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return "";
  return validIso(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
}

function validIso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : "";
}

/** Digits typed in order become DD/MM/YYYY with the slashes added. */
export function autoSlash(raw: string): string {
  const t = raw.trim();
  // A pasted YYYY-MM-DD, or a whole date typed with its own separators ("5/3/2026"), is kept as it is.
  if (/^\d{4}-/.test(t) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(t)) return raw;
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
}

export function DateInput({ value, defaultValue, onChange, name, min, max, className, disabled, range, ...rest }: Props) {
  const { d } = useI18n();
  const controlled = value !== undefined;
  const [text, setText] = useState(() => isoToDisplay(controlled ? value : defaultValue));
  const [iso, setIso] = useState(() => (controlled ? (value ?? "") : (defaultValue ?? "")));
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // In a range, this field publishes its day and takes the day a quick pick sets for its part.
  const group = range ? groupOf(range.group) : null;
  useEffect(() => {
    if (!group || !range) return;
    group[range.part] = iso;
    notify(group);
  }, [group, range, iso]);
  const applyRange = useCallback(
    (from: string, to: string) => {
      if (!range) return;
      const mine = range.part === "from" ? from : to;
      setText(isoToDisplay(mine));
      setIso(mine);
      onChange?.(mine);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range?.part, onChange],
  );
  useEffect(() => {
    if (!group) return;
    group.set.add(applyRange);
    return () => void group.set.delete(applyRange);
  }, [group, applyRange]);
  const snapshot = useSyncExternalStore(
    (cb) => {
      if (!group) return () => {};
      group.listeners.add(cb);
      return () => void group.listeners.delete(cb);
    },
    () => (group ? `${group.from}|${group.to}` : ""),
    () => "",
  );
  const [rangeFrom, rangeTo] = snapshot.split("|");

  // A new value from outside (a reset, or the picker) replaces what's shown, unless it's the same date.
  useEffect(() => {
    if (!controlled) return;
    if ((value ?? "") !== displayToIso(text)) setText(isoToDisplay(value));
    setIso(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: string) => {
    setIso(next);
    onChange?.(next);
  };

  return (
    <span ref={wrap} className={cn("relative inline-flex w-full min-w-36 items-center", className)}>
      {/* The date always reads left to right, so the button sits on the right on Hebrew pages too. */}
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        placeholder="DD/MM/YYYY"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const shown = autoSlash(e.target.value);
          const parsed = displayToIso(shown);
          setText(parsed && ISO.test(shown.trim()) ? isoToDisplay(parsed) : shown);
          if (parsed !== iso) commit(parsed);
        }}
        onBlur={(e) => {
          const parsed = displayToIso(text);
          if (parsed) setText(isoToDisplay(parsed));
          rest.onBlur?.(e);
        }}
        className={cn(fieldBase, "h-10 pl-3 pr-10 text-left")}
      />
      {name && <input type="hidden" name={name} value={iso} />}
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={d.common.pickDate}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("absolute right-1 grid size-8 place-items-center rounded-md hover:bg-slate-100 disabled:opacity-50", open ? "bg-brand-50 text-brand-700" : "text-slate-600")}
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>
      {open && (
        <DatePickerPopover
          anchor={wrap.current}
          value={iso}
          min={min}
          max={max}
          range={
            range && group
              ? {
                  part: range.part,
                  from: rangeFrom ?? "",
                  to: rangeTo ?? "",
                  onRange: (from, to) => {
                    group.set.forEach((apply) => apply(from, to));
                    setOpen(false);
                    button.current?.focus();
                  },
                }
              : undefined
          }
          onPick={(next) => {
            setText(isoToDisplay(next));
            if (next !== iso) commit(next);
            setOpen(false);
            button.current?.focus();
          }}
          onClose={(o) => {
            setOpen(false);
            if (o?.restoreFocus) button.current?.focus();
          }}
        />
      )}
    </span>
  );
}
