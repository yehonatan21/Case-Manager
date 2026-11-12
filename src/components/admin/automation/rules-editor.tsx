"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import { useCategories } from "@/components/app/categories";
import type { AutomationAction, AutomationTrigger, CaseStatus } from "@/lib/db/schema";

export type RuleItem = {
  id: string;
  name: string;
  active: boolean;
  trigger: AutomationTrigger;
  triggerStatus: string | null;
  category: string | null;
  action: AutomationAction;
  runCount: number;
  lastRunAt: string | null;
};

const TRIGGERS: AutomationTrigger[] = ["case_submitted", "documents_complete", "quote_approved", "payment_succeeded", "status_changed", "milestone_completed"];
type Draft = { id?: string; name: string; active: boolean; trigger: AutomationTrigger; triggerStatus: string; category: string; type: AutomationAction["type"]; title: string; dueInDays: string; text: string; he: string; en: string };
const empty: Draft = { name: "", active: true, trigger: "documents_complete", triggerStatus: "", category: "", type: "create_task", title: "", dueInDays: "", text: "", he: "", en: "" };

const toDraft = (r: RuleItem): Draft => ({
  id: r.id,
  name: r.name,
  active: r.active,
  trigger: r.trigger,
  triggerStatus: r.triggerStatus ?? "",
  category: r.category ?? "",
  type: r.action.type,
  title: r.action.type === "create_task" ? r.action.title : "",
  dueInDays: r.action.type === "create_task" && r.action.dueInDays != null ? String(r.action.dueInDays) : "",
  text: r.action.type === "notify_owner" ? r.action.text : "",
  he: r.action.type === "message_client" ? r.action.he : "",
  en: r.action.type === "message_client" ? r.action.en : "",
});

export function RulesEditor({ rules }: { rules: RuleItem[] }) {
  const { d } = useI18n();
  const t = d.automation;
  const categories = useCategories();
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const action = (x: Draft): AutomationAction =>
    x.type === "create_task" ? { type: "create_task", title: x.title, dueInDays: x.dueInDays ? Number(x.dueInDays) : null } : x.type === "notify_owner" ? { type: "notify_owner", text: x.text } : { type: "message_client", he: x.he, en: x.en };
  const ready = (x: Draft) => x.name.trim() && (x.type === "create_task" ? x.title.trim() : x.type === "notify_owner" ? x.text.trim() : x.he.trim() || x.en.trim());

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      const body = { name: draft.name, active: draft.active, trigger: draft.trigger, triggerStatus: draft.trigger === "status_changed" && draft.triggerStatus ? draft.triggerStatus : null, category: draft.category || null, action: action(draft) };
      await api(draft.id ? `/api/admin/automation/${draft.id}` : "/api/admin/automation", { method: draft.id ? "PATCH" : "POST", body });
      toast("success", t.saved);
      setDraft(null);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    setBusy(id);
    try {
      await api(`/api/admin/automation/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  const toggle = async (r: RuleItem) => {
    setBusy(r.id);
    try {
      await api(`/api/admin/automation/${r.id}`, { method: "PATCH", body: { name: r.name, active: !r.active, trigger: r.trigger, triggerStatus: r.triggerStatus, category: r.category, action: r.action } });
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const describe = (r: RuleItem) => {
    const when = r.trigger === "status_changed" && r.triggerStatus ? `${t.triggers.status_changed}: ${d.status.internal[r.triggerStatus as CaseStatus]}` : t.triggers[r.trigger];
    const then = r.action.type === "create_task" ? `${t.actions.create_task}: ${r.action.title}` : r.action.type === "notify_owner" ? t.actions.notify_owner : t.actions.message_client;
    return { when, then };
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.subtitle}</p>
      </div>
      {!draft && (
        <Button onClick={() => setDraft({ ...empty })}>
          <Plus className="size-4" aria-hidden /> {t.new}
        </Button>
      )}
      {draft && (
        <Card>
          <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={t.name} required>
                {(p) => <Input {...p} value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
              </Field>
            </div>
            <Field label={t.when}>
              {(p) => (
                <Select {...p} value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value as AutomationTrigger })}>
                  {TRIGGERS.map((x) => (
                    <option key={x} value={x}>
                      {t.triggers[x]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {draft.trigger === "status_changed" ? (
              <Field label={t.statusLabel}>
                {(p) => (
                  <Select {...p} value={draft.triggerStatus} onChange={(e) => setDraft({ ...draft, triggerStatus: e.target.value })}>
                    <option value="">{t.anyStatus}</option>
                    {(Object.keys(d.status.internal) as CaseStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {d.status.internal[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <span className="hidden sm:block" />
            )}
            <Field label={t.category}>
              {(p) => (
                <Select {...p} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  <option value="">{t.anyCategory}</option>
                  {categories.list.map((c) => (
                    <option key={c.key} value={c.key}>
                      {categories.label(c.key)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.then}>
              {(p) => (
                <Select {...p} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}>
                  {(["create_task", "notify_owner", "message_client"] as const).map((x) => (
                    <option key={x} value={x}>
                      {t.actions[x]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {draft.type === "create_task" && (
              <>
                <Field label={t.taskTitle} required>
                  {(p) => <Input {...p} value={draft.title} maxLength={300} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
                </Field>
                <Field label={t.taskDue}>{(p) => <Input {...p} type="number" dir="ltr" min={0} max={365} value={draft.dueInDays} onChange={(e) => setDraft({ ...draft, dueInDays: e.target.value })} />}</Field>
              </>
            )}
            {draft.type === "notify_owner" && (
              <div className="sm:col-span-2">
                <Field label={t.notifyText} required hint={t.placeholders}>
                  {(p) => <Input {...p} value={draft.text} maxLength={500} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />}
                </Field>
              </div>
            )}
            {draft.type === "message_client" && (
              <>
                <Field label={t.messageHe} hint={t.placeholders}>
                  {(p) => <Textarea {...p} dir="rtl" rows={3} value={draft.he} maxLength={2000} onChange={(e) => setDraft({ ...draft, he: e.target.value })} />}
                </Field>
                <Field label={t.messageEn}>{(p) => <Textarea {...p} dir="ltr" rows={3} value={draft.en} maxLength={2000} onChange={(e) => setDraft({ ...draft, en: e.target.value })} />}</Field>
              </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
              <Checkbox label={t.active} checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  {d.common.cancel}
                </Button>
                <Button loading={busy === "save"} disabled={!ready(draft)} onClick={save}>
                  {t.save}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {rules.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => {
            const x = describe(r);
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-3 rounded-card bg-card shadow-card p-4">
                <Zap className={`mt-0.5 size-5 shrink-0 ${r.active ? "text-brand-700" : "text-slate-400"}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="bidi-auto font-semibold text-slate-900">
                    {r.name} {!r.active && <Badge tone="muted">{d.userStatus.disabled}</Badge>}
                  </p>
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">{t.when}:</span> {x.when}
                    {r.category && <> · {categories.label(r.category)}</>}
                  </p>
                  <p className="bidi-auto text-sm text-slate-700">
                    <span className="font-medium">{t.then}:</span> {x.then}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fmt(t.runs, { n: r.runCount })}
                    {r.lastRunAt && (
                      <>
                        {" · "}
                        {t.lastRun.split("{time}")[0]}
                        <RelativeTime value={r.lastRunAt} />
                        {t.lastRun.split("{time}")[1]}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox label={t.active} checked={r.active} disabled={busy === r.id} onChange={() => toggle(r)} />
                  <Button variant="ghost" size="icon" aria-label={`${d.common.edit}: ${r.name}`} onClick={() => setDraft(toDraft(r))}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${d.common.delete}: ${r.name}`} disabled={busy === r.id} onClick={() => remove(r.id)}>
                    <Trash2 className="size-4 text-slate-500" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
