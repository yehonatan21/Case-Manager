"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fieldBase } from "./form";

/**
 * A time field that always reads and writes 24-hour HH:MM, whatever the browser's language (the browser's own
 * time field shows AM/PM in a US-English browser). It reports "HH:MM", or "" while the time is incomplete.
 * The colon is added while typing; the up and down arrow keys move by `step` minutes.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "step"> & {
  value: string;
  onChange: (time: string) => void;
  /** Minutes the arrow keys move by. */
  step?: number;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "930" → "9:30", "1830" → "18:30", "18:3" → "18:3"; a complete time is returned as HH:MM. */
export function shapeTime(raw: string): string {
  const t = raw.trim();
  const sep = /^(\d{1,2})[:.](\d{0,2})$/.exec(t);
  if (sep) return `${sep[1]}:${sep[2]}`;
  const d = t.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, d.length - 2)}:${d.slice(-2)}`;
}

/** "9:30" or "09:30" → "09:30"; "" when it isn't a complete, real time. */
export function parseTime(text: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return "";
  const t = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  return TIME.test(t) ? t : "";
}

const addMinutes = (t: string, n: number) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const total = (((h * 60 + m + n) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function TimeInput({ value, onChange, step = 5, className, onKeyDown, onBlur, ...rest }: Props) {
  const [text, setText] = useState(value ?? "");

  // A new value from outside replaces what's shown, unless it's the same time.
  useEffect(() => {
    if ((value ?? "") !== parseTime(text)) setText(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = (shown: string) => {
    setText(shown);
    const parsed = parseTime(shown);
    if (parsed !== (value ?? "")) onChange(parsed);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      dir="ltr"
      placeholder="HH:MM"
      maxLength={5}
      value={text}
      onChange={(e) => set(shapeTime(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = parseTime(text) || "09:00";
          set(addMinutes(base, e.key === "ArrowUp" ? step : -step));
        }
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        const parsed = parseTime(text);
        if (parsed) setText(parsed);
        onBlur?.(e);
      }}
      className={cn(fieldBase, "h-10 text-left tabular-nums", className)}
    />
  );
}
