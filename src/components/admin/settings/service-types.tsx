"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { CategoryInfo } from "@/lib/services/categories";

/** Settings → Service types: the built-in types, plus custom ones (added here or created by the intake assistant). */
export function ServiceTypes({ categories }: { categories: CategoryInfo[] }) {
  const { d } = useI18n();
  const t = d.serviceTypes;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ nameHe: "", nameEn: "" });
  const [edit, setEdit] = useState<{ key: string; nameHe: string; nameEn: string } | null>(null);

  const call = async (key: string, fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(key);
    try {
      await fn();
      toast("success", ok);
      after?.();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const custom = categories.filter((c) => !c.builtIn);
  const builtIn = categories.filter((c) => c.builtIn);

  return (
    <div className="grid gap-5">
      <p className="text-sm text-slate-600">{t.intro}</p>
      <Card>
        <CardContent className="py-5">
          <h2 className="text-base font-semibold">{t.customTitle}</h2>
          {custom.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t.noCustom}</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {custom.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  {edit?.key === c.key ? (
                    <form
                      className="grid w-full gap-3 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void call(
                          "save" + c.key,
                          () => api(`/api/admin/categories/${c.key}`, { method: "PATCH", body: { nameHe: edit.nameHe, nameEn: edit.nameEn } }),
                          d.common.saved,
                          () => setEdit(null),
                        );
                      }}
                    >
                      <Field label={t.nameHe}>{(p) => <Input {...p} lang="he" dir="rtl" value={edit.nameHe} onChange={(e) => setEdit({ ...edit, nameHe: e.target.value })} />}</Field>
                      <Field label={t.nameEn}>{(p) => <Input {...p} lang="en" dir="ltr" value={edit.nameEn} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} />}</Field>
                      <div className="flex items-end gap-2">
                        <Button type="submit" size="sm" loading={busy === "save" + c.key}>
                          {d.common.save}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>
                          {d.common.cancel}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="font-medium">
                          <span lang="he">{c.he}</span> · <span lang="en">{c.en}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <code dir="ltr">{c.key}</code>
                          {c.createdByAi && (
                            <Badge tone="brand">
                              <Sparkles className="size-3" aria-hidden /> {t.byAi}
                            </Badge>
                          )}
                          {!c.active && <Badge tone="muted">{t.hidden}</Badge>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          label={t.shown}
                          checked={c.active}
                          disabled={busy === "toggle" + c.key}
                          onChange={(e) => call("toggle" + c.key, () => api(`/api/admin/categories/${c.key}`, { method: "PATCH", body: { active: e.target.checked } }), d.common.saved)}
                        />
                        <Button size="sm" variant="outline" onClick={() => setEdit({ key: c.key, nameHe: c.he, nameEn: c.en })}>
                          {d.common.edit}
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form
            className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void call(
                "add",
                () => api("/api/admin/categories", { body: form }),
                t.added,
                () => setForm({ nameHe: "", nameEn: "" }),
              );
            }}
          >
            <Field label={t.nameHe}>{(p) => <Input {...p} lang="he" dir="rtl" value={form.nameHe} onChange={(e) => setForm({ ...form, nameHe: e.target.value })} />}</Field>
            <Field label={t.nameEn}>{(p) => <Input {...p} lang="en" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />}</Field>
            <div className="flex items-end">
              <Button type="submit" loading={busy === "add"} disabled={form.nameHe.trim().length < 2 || form.nameEn.trim().length < 2}>
                <Plus className="size-4" aria-hidden /> {t.add}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-5">
          <h2 className="text-base font-semibold">{t.builtInTitle}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {builtIn.map((c) => (
              <li key={c.key}>
                <Badge tone="muted">{d.categories[c.key as "other"]}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
