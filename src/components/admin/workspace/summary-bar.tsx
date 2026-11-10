"use client";

import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { RelativeTime } from "@/components/ui/relative-time";
import { ArrowRight, CircleAlert } from "lucide-react";
import { DueBadge } from "@/components/admin/queue/queue-table";
import { cn } from "@/lib/utils";
import type { StaffOption, WorkspaceData } from "./types";

const WAITING_CLIENT = ["awaiting_information", "awaiting_client", "quote_sent", "awaiting_payment"];

/**
 * What's next on the case, first and prominent (late in red, with a way to the tasks), then who handles it, the
 * deadline and the last activity — always visible above the work area.
 */
export function SummaryBar({ c, staff, onOpenTasks }: { c: WorkspaceData; staff: StaffOption[]; onOpenTasks?: () => void }) {
  const { d, locale } = useI18n();
  const t = d.queue.summary;
  const owner = c.assigneeId ? (staff.find((s) => s.id === c.assigneeId)?.name ?? "—") : d.common.unassigned;
  // The next step: the team's nearest open task; otherwise whether it's the client's turn.
  const next = c.tasks.filter((x) => !x.requiresClientAction && !["done", "cancelled"].includes(x.status)).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
  const nextText = next
    ? `${fmt(t.taskNext, { title: next.title })}${next.dueDate ? ` · ${fmt(t.taskDue, { date: formatDate(next.dueDate, locale) })}` : ""}`
    : WAITING_CLIENT.includes(c.status)
      ? d.queue.views.waiting_client
      : t.nothingNext;
  const late = !!next?.dueDate && next.dueDate < c.today;
  const item = "min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200";
  return (
    <dl className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
      <div className={cn("col-span-2 rounded-lg px-4 py-3 ring-1 md:col-span-3", late ? "bg-red-50 ring-red-200" : "bg-brand-50 ring-brand-200")}>
        <dt className={cn("flex items-center gap-1.5 text-xs font-semibold", late ? "text-red-800" : "text-brand-800")}>
          {late && <CircleAlert className="size-3.5" aria-hidden />}
          {t.next}
          {late && <span>· {t.late}</span>}
        </dt>
        <dd className="mt-0.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="bidi-auto min-w-0 text-base font-semibold text-slate-900">{nextText}</span>
          {next && onOpenTasks && (
            <button
              type="button"
              onClick={onOpenTasks}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100"
            >
              {t.openTasks} <ArrowRight className="size-4 flip-rtl" aria-hidden />
            </button>
          )}
        </dd>
      </div>
      <div className={item}>
        <dt className="text-xs text-slate-500">{t.owner}</dt>
        <dd className="truncate font-medium text-slate-900">{owner}</dd>
      </div>
      <div className={item}>
        <dt className="text-xs text-slate-500">{t.due}</dt>
        <dd className="font-medium">{c.dueDate ? <DueBadge due={c.dueDate} today={c.today} /> : <span className="text-slate-500">{t.noDeadline}</span>}</dd>
      </div>
      <div className={item}>
        <dt className="text-xs text-slate-500">{t.activity}</dt>
        <dd className="font-medium text-slate-900">
          <RelativeTime value={c.lastActivityAt} />
          {c.waitingOnThirdParty && (
            <span className="bidi-auto mt-0.5 block text-xs font-normal text-slate-600">
              {t.waiting}: {c.waitingNote || d.queue.views.waiting_third_party}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}
