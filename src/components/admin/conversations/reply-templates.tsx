"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type T = { id: string; title: string; bodyHe: string; bodyEn: string };

/** Managing the team's saved replies (admins and case managers). */
export function ReplyTemplates({ templates, canEdit }: { templates: T[]; canEdit: boolean }) {
  const { d } = useI18n();
  const t = d.replies;
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<(Omit<T, "id"> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      await api(draft.id ? `/api/reply-templates/${draft.id}` : "/api/reply-templates", { method: draft.id ? "PATCH" : "POST", body: { title: draft.title, bodyHe: draft.bodyHe, bodyEn: draft.bodyEn } });
      toast("success", d.common.saved);
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
      await api(`/api/reply-templates/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="replies-title" className="space-y-3">
      <div>
        <h2 id="replies-title" className="text-lg font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-slate-500">{t.subtitle}</p>
      </div>
      {canEdit && !draft && (
        <Button variant="outline" onClick={() => setDraft({ title: "", bodyHe: "", bodyEn: "" })}>
          <Plus className="size-4" aria-hidden /> {t.new}
        </Button>
      )}
      {draft && (
        <Card>
          <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={t.name} required>
                {(p) => <Input {...p} value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
              </Field>
            </div>
            <Field label={t.he}>{(p) => <Textarea {...p} dir="rtl" rows={4} value={draft.bodyHe} onChange={(e) => setDraft({ ...draft, bodyHe: e.target.value })} />}</Field>
            <Field label={t.en}>{(p) => <Textarea {...p} dir="ltr" rows={4} value={draft.bodyEn} onChange={(e) => setDraft({ ...draft, bodyEn: e.target.value })} />}</Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {d.common.cancel}
              </Button>
              <Button loading={busy === "save"} disabled={!draft.title.trim() || (!draft.bodyHe.trim() && !draft.bodyEn.trim())} onClick={save}>
                {d.common.save}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {templates.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {templates.map((x) => (
            <li key={x.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="bidi-auto font-medium text-slate-900">{x.title}</p>
                <p className="bidi-auto line-clamp-2 text-sm text-slate-600">{x.bodyHe || x.bodyEn}</p>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`${d.common.edit}: ${x.title}`} onClick={() => setDraft(x)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${d.common.delete}: ${x.title}`} disabled={busy === x.id} onClick={() => remove(x.id)}>
                    <Trash2 className="size-4 text-slate-500" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
