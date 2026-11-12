"use client";

import { DateInput } from "@/components/ui/date-input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Milestone, Plus, Trash2, UserRoundCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatDate } from "@/lib/i18n/format";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { TaskStatusBadge } from "@/components/app/status";
import { todayIso } from "@/lib/utils";
import type { TaskStatus } from "@/lib/db/schema";
import type { StaffOption, TemplateOption, WorkspaceMilestone, WorkspaceTask } from "./types";
import { cn } from "@/lib/utils";

export function TasksPanel({
  caseId,
  tasks,
  milestones = [],
  today,
  staff,
  templates,
  canEdit,
  focusNew = false,
}: {
  caseId: string;
  tasks: WorkspaceTask[];
  milestones?: WorkspaceMilestone[];
  today?: string;
  staff: StaffOption[];
  templates: TemplateOption[];
  canEdit: boolean;
  /** Put the cursor in the new task's title (opened from Quick Create). */
  focusNew?: boolean;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState("");
  const [clientAction, setClientAction] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    call("add", async () => {
      await api(`/api/cases/${caseId}/tasks`, { body: { tasks: [{ title, assigneeId: assigneeId || null, dueDate: due || null, requiresClientAction: clientAction }] } });
      setTitle("");
      setDue("");
      setClientAction(false);
    });

  const update = (id: string, body: Record<string, unknown>) => call(id, () => api(`/api/tasks/${id}`, { method: "PATCH", body }));
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  // Tasks in the order of the work plan's stages, then the ones outside any stage.
  const groups: { m: WorkspaceMilestone | null; items: WorkspaceTask[] }[] = [
    ...milestones.map((m) => ({ m, items: tasks.filter((t) => t.milestoneId === m.id) })),
    { m: null, items: tasks.filter((t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId)) },
  ].filter((g) => g.m || g.items.length > 0);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            <Input autoFocus={focusNew} aria-label={d.tasks.title} placeholder={d.tasks.new} value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-48 flex-1" onKeyDown={(e) => e.key === "Enter" && title.trim() && add()} />
            <Select aria-label={d.tasks.assignee} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-auto">
              <option value="">{d.tasks.assignee}…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <DateInput aria-label={d.tasks.dueDate} value={due} onChange={setDue} className="w-40" />
            <Button onClick={add} loading={busy === "add"} disabled={!title.trim()}>
              <Plus className="size-4" aria-hidden /> {d.common.add}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Checkbox label={d.tasks.requiresClient} checked={clientAction} onChange={(e) => setClientAction(e.target.checked)} />
            {templates.length > 0 && (
              <Select
                aria-label={d.tasks.applyTemplate}
                value=""
                className="h-8 w-auto text-xs"
                disabled={busy === "tpl"}
                onChange={(e) => e.target.value && call("tpl", () => api(`/api/cases/${caseId}/tasks`, { body: { templateId: e.target.value } }))}
              >
                <option value="">{d.tasks.applyTemplate}…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState title={d.tasks.empty} className="py-8" />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.m?.id ?? "other"} aria-label={g.m?.title ?? d.workPlan.otherTasks}>
              {g.m ? (
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className={cn("bidi-auto flex items-center gap-2 text-sm font-semibold", g.m.completedAt ? "text-emerald-800" : "text-slate-900")}>
                    {g.m.completedAt ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <Milestone className="size-4 text-brand-700" aria-hidden />}
                    {g.m.title}
                    {g.m.dueDate && <span className={cn("text-xs font-normal", !g.m.completedAt && today && g.m.dueDate < today ? "font-semibold text-red-600" : "text-slate-500")}>{formatDate(g.m.dueDate, locale)}</span>}
                    {!g.m.clientVisible && <Badge tone="muted">{d.workPlan.teamOnly}</Badge>}
                  </h3>
                  {canEdit && (
                    <Button size="sm" variant="ghost" loading={busy === g.m.id} onClick={() => call(g.m!.id, () => api(`/api/milestones/${g.m!.id}`, { method: "PATCH", body: { done: !g.m!.completedAt } }))}>
                      {g.m.completedAt ? d.workPlan.reopen : d.workPlan.markDone}
                    </Button>
                  )}
                </div>
              ) : (
                milestones.length > 0 && <h3 className="mb-1.5 text-sm font-semibold text-slate-700">{d.workPlan.otherTasks}</h3>
              )}
              {g.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">{d.workPlan.noTasks}</p>
              ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-card">
          {g.items.map((t) => {
            const overdue = t.dueDate && t.dueDate < todayIso() && !["done", "cancelled"].includes(t.status);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={t.status === "done"}
                  disabled={!canEdit || busy === t.id}
                  onChange={(e) => update(t.id, { status: e.target.checked ? "done" : "todo" })}
                  aria-label={`${d.tasks.markDone}: ${t.title}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("bidi-auto text-sm font-medium", t.status === "done" ? "text-slate-500 line-through" : "text-slate-900")}>{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {t.dueDate && <span className={cn(overdue && "font-semibold text-red-600")}>{formatDate(t.dueDate, locale)}{overdue && ` · ${d.tasks.overdue}`}</span>}
                    {t.requiresClientAction && (
                      <Badge tone="warning">
                        <UserRoundCheck className="size-3" aria-hidden /> {d.tasks.requiresClient}
                      </Badge>
                    )}
                    {t.priority === "high" && <Badge tone="danger">{d.priority.high}</Badge>}
                    {t.dependsOnId && t.status === "waiting" && (
                      <Badge tone="neutral">
                        <Lock className="size-3" aria-hidden /> {fmt(d.workPlan.waitsFor, { title: titleOf.get(t.dependsOnId) ?? "" })}
                      </Badge>
                    )}
                  </div>
                </div>
                {canEdit ? (
                  <>
                    <Select aria-label={d.tasks.assignee} value={t.assigneeId ?? ""} onChange={(e) => update(t.id, { assigneeId: e.target.value || null })} className="h-8 w-auto text-xs">
                      <option value="">{d.common.unassigned}</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <Select aria-label={d.tasks.status} value={t.status} onChange={(e) => update(t.id, { status: e.target.value as TaskStatus })} className="h-8 w-auto text-xs">
                      {(["todo", "in_progress", "waiting", "done", "cancelled"] as const).map((s) => (
                        <option key={s} value={s}>
                          {d.taskStatus[s]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={d.common.delete}
                      onClick={() => confirm(d.tasks.deleteConfirm) && call(t.id, () => api(`/api/tasks/${t.id}`, { method: "DELETE" }))}
                    >
                      <Trash2 className="size-4 text-slate-500" />
                    </Button>
                  </>
                ) : (
                  <TaskStatusBadge status={t.status} />
                )}
              </li>
            );
          })}
        </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
