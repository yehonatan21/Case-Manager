"use client";

import { DateInput } from "@/components/ui/date-input";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Hourglass } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { CaseStatusBadge, UrgencyBadge } from "@/components/app/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import type { CaseStatus, Urgency } from "@/lib/db/schema";

export type QueueItem = {
  id: string;
  number: string;
  title: string;
  status: CaseStatus;
  urgency: Urgency;
  customerName: string;
  assigneeName: string | null;
  dueDate: string | null;
  waitingOnThirdParty: boolean;
  waitingNote: string | null;
  overdueTasks: number;
  nextTaskDue: string | null;
  lastActivityAt: string;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);

/** Deadline text and tone relative to the office's today. */
export function DueBadge({ due, today }: { due: string | null; today: string }) {
  const { d, locale } = useI18n();
  const t = d.queue;
  if (!due) return <span className="text-slate-500">—</span>;
  const n = daysBetween(today, due);
  const label = n < 0 ? fmt(t.daysLate, { n: -n }) : n === 0 ? t.dueToday : n === 1 ? t.dueTomorrow : n <= 7 ? fmt(t.dueInDays, { n }) : null;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap text-slate-700">{formatDate(due, locale)}</span>
      {label && (
        <Badge tone={n < 0 ? "danger" : n <= 1 ? "warning" : "info"} className="w-fit">
          {n < 0 ? <AlertTriangle className="size-3" aria-hidden /> : <CalendarClock className="size-3" aria-hidden />}
          {label}
        </Badge>
      )}
    </span>
  );
}

export function QueueTable({ rows, today, canBulk, staff }: { rows: QueueItem[]; today: string; canBulk: boolean; staff: { id: string; name: string }[] }) {
  const { d, locale } = useI18n();
  const t = d.queue;
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState("");
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const numberOf = useMemo(() => new Map(rows.map((r) => [r.id, r.number])), [rows]);

  if (rows.length === 0) return <EmptyState title={t.empty} />;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const apply = async (action: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await api<{ done: string[]; failed: { id: string; number: string; code: string }[] }>("/api/cases/bulk", { method: "POST", body: { ids: [...selected], action } });
      if (r.done.length) toast("success", fmt(t.bulkDone, { n: r.done.length }));
      if (r.failed.length) {
        const list = r.failed.map((f) => `${f.number || numberOf.get(f.id) || ""} (${(d.errors as Record<string, string>)[f.code] ?? f.code})`).join(", ");
        toast("error", fmt(t.bulkFailed, { n: r.failed.length, list }));
      }
      setSelected(new Set(r.failed.map((f) => f.id)));
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {canBulk && selected.size > 0 && (
        <div role="region" aria-label={fmt(t.selected, { n: selected.size })} className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 shadow-sm">
          <span className="text-sm font-semibold text-brand-900">{fmt(t.selected, { n: selected.size })}</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t.clearSelection}
          </Button>
          <Select aria-label={t.bulkAssign} className="w-auto" value="" disabled={busy} onChange={(e) => e.target.value && apply({ type: "assign", assigneeId: e.target.value === "none" ? null : e.target.value })}>
            <option value="">{t.bulkAssign}</option>
            <option value="none">{d.common.unassigned}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select aria-label={t.bulkUrgency} className="w-auto" value="" disabled={busy} onChange={(e) => e.target.value && apply({ type: "urgency", urgency: e.target.value })}>
            <option value="">{t.bulkUrgency}</option>
            {(["urgent", "high", "normal", "low"] as const).map((u) => (
              <option key={u} value={u}>
                {d.urgency[u]}
              </option>
            ))}
          </Select>
          <Select aria-label={t.bulkStatus} className="w-auto" value="" disabled={busy} onChange={(e) => e.target.value && apply({ type: "status", status: e.target.value })}>
            <option value="">{t.bulkStatus}</option>
            {(Object.keys(d.status.internal) as CaseStatus[]).map((s) => (
              <option key={s} value={s}>
                {d.status.internal[s]}
              </option>
            ))}
          </Select>
          <span className="flex items-center gap-1">
            <DateInput aria-label={t.bulkDue} className="w-40" value={due} onChange={setDue} />
            <Button size="sm" variant="outline" disabled={busy || !due} onClick={() => apply({ type: "due_date", dueDate: due })}>
              {t.bulkApply}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply({ type: "due_date", dueDate: null })}>
              {t.bulkClearDue}
            </Button>
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              {canBulk && (
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" className="size-4 accent-brand-700" aria-label={t.selectAll} checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              )}
              <th className="px-3 py-3 text-start font-medium">{t.col.case}</th>
              <th className="px-3 py-3 text-start font-medium">{t.col.status}</th>
              <th className="px-3 py-3 text-start font-medium">{t.col.urgency}</th>
              <th className="px-3 py-3 text-start font-medium">{t.col.due}</th>
              <th className="px-3 py-3 text-start font-medium">{t.col.tasks}</th>
              <th className="px-3 py-3 text-start font-medium">{t.col.assignee}</th>
              <th className="px-3 py-3 text-start font-medium">{t.col.activity}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-brand-50/60" : "hover:bg-slate-50"}>
                {canBulk && (
                  <td className="px-3 py-3 align-top">
                    <input type="checkbox" className="size-4 accent-brand-700" aria-label={fmt(t.selectCase, { number: r.number })} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td className="px-3 py-3 align-top">
                  <Link href={`/admin/cases/${r.id}`} className="bidi-auto font-medium text-slate-900 hover:text-brand-700 hover:underline">
                    {r.title}
                  </Link>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    <span dir="ltr" className="font-mono">
                      {r.number}
                    </span>{" "}
                    · <span className="bidi-auto">{r.customerName}</span>
                  </span>
                  {r.waitingOnThirdParty && (
                    <Badge tone="neutral" className="mt-1">
                      <Hourglass className="size-3" aria-hidden />
                      <span className="sr-only">{t.col.waiting}: </span>
                      {r.waitingNote || d.queue.views.waiting_third_party}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  <CaseStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-3 align-top">
                  <UrgencyBadge urgency={r.urgency} />
                </td>
                <td className="px-3 py-3 align-top">
                  <DueBadge due={r.dueDate} today={today} />
                </td>
                <td className="px-3 py-3 align-top text-xs">
                  {r.overdueTasks > 0 ? (
                    <Badge tone="danger">{fmt(t.overdueTasks, { n: r.overdueTasks })}</Badge>
                  ) : r.nextTaskDue ? (
                    <span className="text-slate-600">{fmt(t.nextTask, { date: formatDate(r.nextTaskDue, locale) })}</span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top text-slate-700">{r.assigneeName ?? <span className="text-slate-500">{d.common.unassigned}</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 align-top text-slate-600">
                  <RelativeTime value={r.lastActivityAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
