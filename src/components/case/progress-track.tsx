"use client";

import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { CLIENT_TRACK, clientTrackIndex } from "@/lib/domain";
import type { CaseStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/** Real stage progression (no synthetic percentages): done, current, upcoming. */
export function ProgressTrack({ status }: { status: CaseStatus }) {
  const { d } = useI18n();
  const idx = clientTrackIndex(status);
  if (idx < 0) return null;
  const allDone = status === "completed" || status === "closed";
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label={d.caseView.progressTitle}>
      {CLIENT_TRACK.map((s, i) => {
        const done = i < idx || (allDone && i === idx);
        const current = i === idx && !allDone;
        return (
          <li key={s} className="flex flex-col items-center text-center" aria-current={current ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : i <= idx ? "bg-brand-600" : "bg-slate-200")} />
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done ? "bg-brand-700 text-white" : current ? "bg-white text-brand-800 ring-2 ring-brand-600" : "bg-slate-100 text-slate-500",
                )}
              >
                {done ? <Check className="size-4" aria-label={d.caseView.stepDone} /> : i + 1}
              </span>
              <span className={cn("h-0.5 flex-1", i === CLIENT_TRACK.length - 1 ? "bg-transparent" : i < idx ? "bg-brand-600" : "bg-slate-200")} />
            </div>
            <span className={cn("mt-1.5 text-[11px] leading-tight sm:text-xs", current ? "font-semibold text-brand-800" : done ? "text-slate-700" : "text-slate-500")}>
              {d.status.client[s]}
              {current && <span className="sr-only"> ({d.caseView.stepCurrent})</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
