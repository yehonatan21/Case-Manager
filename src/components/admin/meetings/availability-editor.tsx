"use client";

import { TimeInput } from "@/components/ui/time-input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { WeeklyHours } from "@/lib/db/schema";

const DAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

/** A team member's weekly hours for meetings (Israel time). */
export function AvailabilityEditor({ initial }: { initial: { bookable: boolean; weekly: WeeklyHours } }) {
  const { d } = useI18n();
  const t = d.meetings;
  const router = useRouter();
  const toast = useToast();
  const [bookable, setBookable] = useState(initial.bookable);
  const [weekly, setWeekly] = useState<WeeklyHours>(initial.weekly);
  const [busy, setBusy] = useState(false);

  const setRange = (day: (typeof DAYS)[number], i: number, key: "start" | "end", v: string) =>
    setWeekly({ ...weekly, [day]: weekly[day].map((r, k) => (k === i ? { ...r, [key]: v } : r)) });
  /** The next free range of the day: after the last one, up to two hours (none when the day is full). */
  const nextRange = (day: (typeof DAYS)[number]) => {
    const last = weekly[day].at(-1);
    if (!last) return { start: "09:00", end: "17:00" };
    const [h, m] = last.end.split(":").map(Number) as [number, number];
    const startMin = h * 60 + m;
    const endMin = Math.min(startMin + 120, 23 * 60 + 45);
    if (endMin - startMin < 30) return null;
    const hhmm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
    return { start: hhmm(startMin), end: hhmm(endMin) };
  };
  const add = (day: (typeof DAYS)[number]) => {
    const r = nextRange(day);
    if (r) setWeekly({ ...weekly, [day]: [...weekly[day], r] });
  };
  const remove = (day: (typeof DAYS)[number], i: number) => setWeekly({ ...weekly, [day]: weekly[day].filter((_, k) => k !== i) });

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/me/availability", { method: "PUT", body: { bookable, weekly } });
      toast("success", t.hoursSaved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div>
          <h2 className="text-base font-semibold">{t.availability}</h2>
          <p className="text-sm text-slate-600">{t.availabilityHint}</p>
        </div>
        <Checkbox label={t.bookable} checked={bookable} onChange={(e) => setBookable(e.target.checked)} />
        <ul className="divide-y divide-slate-100">
          {DAYS.map((day) => (
            <li key={day} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="w-20 shrink-0 text-sm font-medium" id={`day-${day}`}>
                {t.days[Number(day)]}
              </span>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {weekly[day].length === 0 && <span className="text-sm text-slate-500">{t.dayOff}</span>}
                {weekly[day].map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5" role="group" aria-labelledby={`day-${day}`}>
                    <TimeInput step={15} className="h-9 w-20" aria-label={`${t.days[Number(day)]} ${t.from}`} value={r.start} onChange={(v) => setRange(day, i, "start", v)} />
                    <span className="text-sm text-slate-500">{t.to}</span>
                    <TimeInput step={15} className="h-9 w-20" aria-label={`${t.days[Number(day)]} ${t.to}`} value={r.end} onChange={(v) => setRange(day, i, "end", v)} />
                    <button type="button" onClick={() => remove(day, i)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`${t.removeRange}: ${t.days[Number(day)]} ${r.start}–${r.end}`}>
                      <X className="size-4" aria-hidden />
                    </button>
                  </span>
                ))}
                {weekly[day].length < 4 && nextRange(day) && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => add(day)} aria-label={`${t.addRange}: ${t.days[Number(day)]}`}>
                    <Plus className="size-4" aria-hidden /> {t.addRange}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>
            {t.saveHours}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
