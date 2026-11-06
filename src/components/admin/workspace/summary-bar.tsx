"use client";

import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { RelativeTime } from "@/components/ui/relative-time";
import { DueBadge } from "@/components/admin/queue/queue-table";
import type { StaffOption, WorkspaceData } from "./types";

const WAITING_CLIENT = ["awaiting_information", "awaiting_client", "quote_sent", "awaiting_payment"];

/** Who handles the case, what's next, the deadline and the last activity, always visible above the work area. */
export function SummaryBar({ c, staff }: { c: WorkspaceData; staff: StaffOption[] }) {
  const { d, locale } = useI18n();
  const t = d.queue.summary;
  const owner = c.assigneeId ? (staff.find((s) => s.id === c.assigneeId)?.name ?? "—") : d.common.unassigned;
  // The next step: the team's nearest open task; otherwise whether it's the client's turn.
  const next = c.tasks
    .filter((x) => !x.requiresClientAction && !["done", "cancelled"].includes(x.status))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
  const nextText = next
    ? `${fmt(t.taskNext, { title: next.title })}${next.dueDate ? ` · ${fmt(t.taskDue, { date: formatDate(next.dueDate, locale) })}` : ""}`
    : WAITING_CLIENT.includes(c.status)
      ? d.queue.views.waiting_client
      : t.nothingNext;
  const item = "min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200";
  return (
    <dl className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
      <div className={item}>
        <dt className="text-xs text-slate-500">{t.owner}</dt>
        <dd className="truncate font-medium text-slate-900">{owner}</dd>
      </div>
      <div className={item}>
        <dt className="text-xs text-slate-500">{t.next}</dt>
        <dd className="bidi-auto line-clamp-2 font-medium text-slate-900">{nextText}</dd>
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
