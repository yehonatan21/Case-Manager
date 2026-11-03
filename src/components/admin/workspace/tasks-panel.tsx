"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserRoundCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatDate } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { TaskStatusBadge } from "@/components/app/status";
import { todayIso } from "@/lib/utils";
import type { TaskStatus } from "@/lib/db/schema";
import type { StaffOption, TemplateOption, WorkspaceTask } from "./types";
import { cn } from "@/lib/utils";

export function TasksPanel({ caseId, tasks, staff, templates, canEdit }: { caseId: string; tasks: WorkspaceTask[]; staff: StaffOption[]; templates: TemplateOption[]; canEdit: boolean }) {
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

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            <Input aria-label={d.tasks.title} placeholder={d.tasks.new} value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-48 flex-1" onKeyDown={(e) => e.key === "Enter" && title.trim() && add()} />
            <Select aria-label={d.tasks.assignee} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-auto">
              <option value="">{d.tasks.assignee}…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input aria-label={d.tasks.dueDate} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-auto" />
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
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {tasks.map((t) => {
            const overdue = t.dueDate && t.dueDate < todayIso() && !["done", "cancelled"].includes(t.status);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={t.status === "done"}
                  disabled={!canEdit || busy === t.id}
                  onChange={(e) => update(t.id, { status: e.target.checked ? "done" : "todo" })}
                  aria-label={d.tasks.markDone}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("bidi-auto text-sm font-medium", t.status === "done" ? "text-slate-400 line-through" : "text-slate-900")}>{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {t.dueDate && <span className={cn(overdue && "font-semibold text-red-600")}>{formatDate(t.dueDate, locale)}{overdue && ` · ${d.tasks.overdue}`}</span>}
                    {t.requiresClientAction && (
                      <Badge tone="warning">
                        <UserRoundCheck className="size-3" aria-hidden /> {d.tasks.requiresClient}
                      </Badge>
                    )}
                    {t.priority === "high" && <Badge tone="danger">{d.priority.high}</Badge>}
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
                      <Trash2 className="size-4 text-slate-400" />
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
    </div>
  );
}
