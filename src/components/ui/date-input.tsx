"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { fieldBase } from "./form";

/**
 * A date field that always reads and writes DD/MM/YYYY, whatever the browser's language (the browser's own date
 * field follows the browser's settings, which shows MM/DD/YYYY in a US-English browser). The value it reports is
 * YYYY-MM-DD, or "" while the date is empty or incomplete. The calendar button opens the browser's date picker.
 * With `name`, the YYYY-MM-DD value is also sent with a plain form.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "min" | "max"> & {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  min?: string;
  max?: string;
};

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

export function DateInput({ value, defaultValue, onChange, name, min, max, className, disabled, ...rest }: Props) {
  const { d } = useI18n();
  const controlled = value !== undefined;
  const [text, setText] = useState(() => isoToDisplay(controlled ? value : defaultValue));
  const [iso, setIso] = useState(() => (controlled ? (value ?? "") : (defaultValue ?? "")));
  const picker = useRef<HTMLInputElement>(null);

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
    <span className={cn("relative inline-flex w-full min-w-36 items-center", className)}>
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
        className={cn(fieldBase, "h-10 pe-10 text-start")}
      />
      {name && <input type="hidden" name={name} value={iso} />}
      <button
        type="button"
        disabled={disabled}
        aria-label={d.common.pickDate}
        onClick={() => {
          const p = picker.current;
          if (!p) return;
          p.value = iso;
          try {
            p.showPicker();
          } catch {
            p.focus();
          }
        }}
        className="absolute end-1 grid size-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>
      {/* The browser's picker, opened by the button; it isn't a field of its own. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        className="pointer-events-none absolute bottom-0 end-0 h-0 w-0 opacity-0"
        onChange={(e) => {
          const next = validIso(e.target.value);
          setText(isoToDisplay(next));
          if (next !== iso) commit(next);
        }}
      />
    </span>
  );
}
