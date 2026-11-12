"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useCategories } from "@/components/app/categories";
import type { ServiceTemplateDocument, ServiceTemplateStage, ServiceTemplateTask } from "@/lib/db/schema";
import { formatWorkPlan, parseWorkPlan } from "@/lib/work-plan";
import { useSave } from "./use-save";

export type Template = {
  id: string;
  name: string;
  category: string;
  description: string;
  tasks: ServiceTemplateTask[];
  stages?: ServiceTemplateStage[];
  documents: ServiceTemplateDocument[];
  active: boolean;
};

/** Documents are edited one per line: "Title" or "Title | note". */
const docsToText = (docs: ServiceTemplateDocument[], required: boolean) =>
  docs
    .filter((x) => (x.required ?? true) === required)
    .map((x) => `${x.title}${x.note ? ` | ${x.note}` : ""}`)
    .join("\n");
const textToDocs = (text: string, required: boolean): ServiceTemplateDocument[] =>
  text
    .split("\n")
    .map((line) => line.split("|").map((p) => p.trim()))
    .filter(([title]) => title)
    .map(([title, ...note]) => ({ title: title!, note: note.join(" | ") || undefined, required }));

const emptyTpl = { name: "", category: "other", description: "", tasks: "", docsRequired: "", docsOptional: "" };

/** Settings → Service templates: work plans (stages and tasks) and the documents each service needs. */
export function TemplatesSettings({ templates }: { templates: Template[] }) {
  const { d, locale } = useI18n();
  const categories = useCategories();
  const { busy, call } = useSave();
  const [tpl, setTpl] = useState<{ id?: string; name: string; category: string; description: string; tasks: string; docsRequired: string; docsOptional: string }>(emptyTpl);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
      <ul className="space-y-3">
        {templates.map((t) => (
          <li key={t.id} className="rounded-card bg-card shadow-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="bidi-auto font-semibold">{t.name}</p>
                <p className="text-xs text-slate-500">
                  {categories.label(t.category)} {!t.active && <Badge tone="muted">{d.settingsPage.inactive}</Badge>}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setTpl({
                      id: t.id,
                      name: t.name,
                      category: t.category,
                      description: t.description,
                      tasks: formatWorkPlan(t.stages ?? [], t.tasks, locale === "he" ? "צוות" : "team"),
                      docsRequired: docsToText(t.documents, true),
                      docsOptional: docsToText(t.documents, false),
                    })
                  }
                >
                  {d.common.edit}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={d.common.delete}
                  onClick={() => confirm(d.tasks.deleteConfirm) && call(t.id, () => api(`/api/admin/templates/${t.id}`, { method: "DELETE" }))}
                >
                  <Trash2 className="size-4 text-slate-500" />
                </Button>
              </div>
            </div>
            <ol className="mt-2 list-inside list-decimal space-y-0.5 text-sm text-slate-700">
              {t.tasks.map((x, i) => (
                <li key={i} className="bidi-auto">
                  {x.title}
                  {x.requiresClientAction && (
                    <Badge tone="warning" className="ms-1.5">
                      {d.tasks.requiresClient}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
            {t.documents.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-600">{d.settingsPage.templateDocsTitle}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {t.documents.map((x, i) => (
                    <li key={i}>
                      <Badge tone={x.required === false ? "muted" : "info"} className="bidi-auto">
                        {x.title}
                        {x.required === false && <span> · {d.checklist.optional}</span>}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Card>
        <CardContent className="space-y-3 py-4">
          <p className="font-semibold">{tpl.id ? d.common.edit : d.settingsPage.newTemplate}</p>
          <Field label={d.settingsPage.templateName}>{(p) => <Input {...p} value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />}</Field>
          <Field label={d.workspace.category}>
            {(p) => (
              <Select {...p} value={tpl.category} onChange={(e) => setTpl({ ...tpl, category: e.target.value })}>
                {categories.list.map((c) => (
                  <option key={c.key} value={c.key}>
                    {categories.label(c.key)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={d.tasks.description}>{(p) => <Input {...p} value={tpl.description} onChange={(e) => setTpl({ ...tpl, description: e.target.value })} />}</Field>
          <Field label={d.workPlan.editorLabel} hint={d.workPlan.editorHint}>
            {(p) => <Textarea {...p} value={tpl.tasks} rows={10} className="font-mono text-sm" onChange={(e) => setTpl({ ...tpl, tasks: e.target.value })} />}
          </Field>
          <Field label={d.settingsPage.templateDocsRequired} hint={d.settingsPage.templateDocsHint}>
            {(p) => <Textarea {...p} value={tpl.docsRequired} rows={4} className="bidi-auto" onChange={(e) => setTpl({ ...tpl, docsRequired: e.target.value })} />}
          </Field>
          <Field label={d.settingsPage.templateDocsOptional}>
            {(p) => <Textarea {...p} value={tpl.docsOptional} rows={2} className="bidi-auto" onChange={(e) => setTpl({ ...tpl, docsOptional: e.target.value })} />}
          </Field>
          <div className="flex justify-end gap-2">
            {tpl.id && (
              <Button variant="ghost" onClick={() => setTpl(emptyTpl)}>
                {d.common.cancel}
              </Button>
            )}
            <Button
              loading={busy === "tpl"}
              disabled={!tpl.name.trim()}
              onClick={() =>
                call(
                  "tpl",
                  () =>
                    api(tpl.id ? `/api/admin/templates/${tpl.id}` : "/api/admin/templates", {
                      method: tpl.id ? "PATCH" : "POST",
                      body: {
                        name: tpl.name,
                        category: tpl.category,
                        description: tpl.description,
                        ...parseWorkPlan(tpl.tasks),
                        documents: [...textToDocs(tpl.docsRequired, true), ...textToDocs(tpl.docsOptional, false)],
                      },
                    }),
                  () => setTpl(emptyTpl),
                )
              }
            >
              {d.common.save}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
