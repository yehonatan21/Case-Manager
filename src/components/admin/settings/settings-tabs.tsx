"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatMoney } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { TabList, TabPanel } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { SERVICE_CATEGORIES } from "@/lib/domain";
import type { AppSettings } from "@/lib/services/settings";
import type { ServiceTemplateDocument, ServiceTemplateTask, UserRole } from "@/lib/db/schema";

type Staff = { id: string; name: string; email: string; role: UserRole; status: "active" | "invited" | "disabled" };
type Template = { id: string; name: string; category: string; description: string; tasks: ServiceTemplateTask[]; documents: ServiceTemplateDocument[]; active: boolean };
type Price = { id: string; code: string; name: string; category: string; unitPriceCents: number; currency: string; active: boolean };

const STAFF_ROLES: UserRole[] = ["admin", "case_manager", "staff", "finance"];

/** "Title" per line; a leading or trailing * marks a client action. */
const tasksToText = (tasks: ServiceTemplateTask[]) => tasks.map((t) => `${t.requiresClientAction ? "* " : ""}${t.title}${t.dueInDays != null ? ` | ${t.dueInDays}` : ""}`).join("\n");
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
const textToTasks = (s: string): ServiceTemplateTask[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const client = l.startsWith("*") || l.endsWith("*");
      const [title, days] = l.replace(/^\*\s*|\s*\*$/g, "").split("|").map((x) => x.trim());
      return { title: title!, requiresClientAction: client, ...(days && !isNaN(Number(days)) ? { dueInDays: Number(days) } : {}) };
    });

export function SettingsTabs({
  initialTab,
  currentUserId,
  settings,
  staff,
  templates,
  prices,
  integrations,
}: {
  initialTab?: string;
  currentUserId: string;
  settings: AppSettings;
  staff: Staff[];
  templates: Template[];
  prices: Price[];
  /** Rendered in the Integrations tab (WhatsApp). */
  integrations?: React.ReactNode;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState(["general", "users", "templates", "priceList", "integrations"].includes(initialTab ?? "") ? initialTab! : "general");
  const [busy, setBusy] = useState<string | null>(null);
  const [s, setS] = useState(settings);
  const [invite, setInvite] = useState({ email: "", name: "", role: "case_manager" as UserRole });
  const emptyTpl = { name: "", category: "other", description: "", tasks: "", docsRequired: "", docsOptional: "" };
  const [tpl, setTpl] = useState<{ id?: string; name: string; category: string; description: string; tasks: string; docsRequired: string; docsOptional: string }>(emptyTpl);
  const [price, setPrice] = useState({ code: "", name: "", category: "other", price: "", currency: settings.currency });

  const call = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    try {
      await fn();
      toast("success", d.common.saved);
      after?.();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <TabList
        value={tab}
        onChange={setTab}
        label={d.settingsPage.title}
        tabs={[
          { id: "general", label: d.settingsPage.tabs.general },
          { id: "users", label: d.settingsPage.tabs.users },
          { id: "templates", label: d.settingsPage.tabs.templates },
          { id: "priceList", label: d.settingsPage.tabs.priceList },
          ...(integrations ? [{ id: "integrations", label: d.settingsPage.tabs.integrations }] : []),
        ]}
      />
      <div className="pt-5">
        {integrations && (
          <TabPanel id="integrations" active={tab === "integrations"} className="max-w-3xl space-y-4">
            {integrations}
          </TabPanel>
        )}
        <TabPanel id="general" active={tab === "general"}>
          <Card className="max-w-2xl">
            <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
              <Field label={d.settingsPage.companyName}>{(p) => <Input {...p} value={s.company.name} onChange={(e) => setS({ ...s, company: { ...s.company, name: e.target.value } })} />}</Field>
              <Field label={d.settingsPage.companyEmail}>{(p) => <Input {...p} dir="ltr" value={s.company.email} onChange={(e) => setS({ ...s, company: { ...s.company, email: e.target.value } })} />}</Field>
              <Field label={d.settingsPage.companyPhone}>{(p) => <Input {...p} dir="ltr" value={s.company.phone} onChange={(e) => setS({ ...s, company: { ...s.company, phone: e.target.value } })} />}</Field>
              <Field label={d.settingsPage.currency}>
                {(p) => (
                  <Select {...p} value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })}>
                    {["ILS", "USD", "EUR", "GBP"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={d.settingsPage.vatRate}>{(p) => <Input {...p} type="number" dir="ltr" value={s.vat_rate} onChange={(e) => setS({ ...s, vat_rate: Number(e.target.value) })} />}</Field>
              <Field label={d.settingsPage.quoteValidity}>{(p) => <Input {...p} type="number" dir="ltr" value={s.quote_validity_days} onChange={(e) => setS({ ...s, quote_validity_days: Number(e.target.value) })} />}</Field>
              <Field label={d.settingsPage.sla}>{(p) => <Input {...p} type="number" dir="ltr" value={s.first_response_sla_hours} onChange={(e) => setS({ ...s, first_response_sla_hours: Number(e.target.value) })} />}</Field>
              <Field label={d.settingsPage.questionLimit}>{(p) => <Input {...p} type="number" dir="ltr" value={s.intake_question_limit} onChange={(e) => setS({ ...s, intake_question_limit: Number(e.target.value) })} />}</Field>
              <Field label={d.settingsPage.docReminderDays} hint={d.settingsPage.docReminderDaysHint}>
                {(p) => <Input {...p} type="number" dir="ltr" min={0} max={60} value={s.document_reminder_days} onChange={(e) => setS({ ...s, document_reminder_days: Number(e.target.value) })} />}
              </Field>
              <Field label={d.settingsPage.docReminderMax}>
                {(p) => <Input {...p} type="number" dir="ltr" min={1} max={10} value={s.document_reminder_max} onChange={(e) => setS({ ...s, document_reminder_max: Number(e.target.value) })} />}
              </Field>
              <div className="sm:col-span-2 flex justify-end">
                <Button loading={busy === "general"} onClick={() => call("general", () => api("/api/admin/settings", { method: "PATCH", body: s }))}>
                  {d.common.save}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabPanel>

        <TabPanel id="users" active={tab === "users"} className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 py-4">
              <Field label={d.common.name} className="min-w-40 flex-1">{(p) => <Input {...p} value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />}</Field>
              <Field label={d.common.email} className="min-w-52 flex-1">{(p) => <Input {...p} dir="ltr" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}</Field>
              <Field label={d.admin.col.role}>
                {(p) => (
                  <Select {...p} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as UserRole })}>
                    {STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {d.roles[r]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button
                loading={busy === "invite"}
                disabled={!invite.name.trim() || !invite.email.includes("@")}
                onClick={async () => {
                  setBusy("invite");
                  try {
                    const r = await api<{ outcome: "invited" | "converted" | "reactivated" }>("/api/admin/users", { body: invite });
                    const msg = { invited: d.settingsPage.inviteDone, converted: d.settingsPage.inviteConverted, reactivated: d.settingsPage.inviteReactivated }[r.outcome];
                    toast("success", fmt(msg, { email: invite.email.trim() }));
                    setInvite({ email: "", name: "", role: "case_manager" });
                    router.refresh();
                  } catch (e) {
                    toast("error", errorText(e, d));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Plus className="size-4" /> {d.settingsPage.invite}
              </Button>
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{d.common.name}</th>
                  <th className="px-4 py-3 text-start font-medium">{d.common.email}</th>
                  <th className="px-4 py-3 text-start font-medium">{d.admin.col.role}</th>
                  <th className="px-4 py-3 text-start font-medium">{d.common.status}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staff.map((u) => (
                  <tr key={u.id}>
                    <td className="bidi-auto px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-slate-600" dir="ltr">{u.email}</td>
                    <td className="px-4 py-3">
                      <Select
                        aria-label={d.admin.col.role}
                        value={u.role}
                        disabled={u.id === currentUserId}
                        className="h-8 w-auto text-xs"
                        onChange={(e) => call(u.id, () => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                      >
                        {STAFF_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {d.roles[r]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.status === "active" ? "success" : u.status === "invited" ? "info" : "muted"}>{d.userStatus[u.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {u.id !== currentUserId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === u.id}
                          onClick={() => call(u.id, () => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { status: u.status === "disabled" ? "active" : "disabled" } }))}
                        >
                          {u.status === "disabled" ? d.settingsPage.enable : d.settingsPage.disable}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabPanel>

        <TabPanel id="templates" active={tab === "templates"} className="grid gap-5 lg:grid-cols-[1fr_24rem]">
          <ul className="space-y-3">
            {templates.map((t) => (
              <li key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="bidi-auto font-semibold">{t.name}</p>
                    <p className="text-xs text-slate-500">
                      {d.categories[t.category as "other"] ?? t.category} {!t.active && <Badge tone="muted">{d.settingsPage.inactive}</Badge>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setTpl({ id: t.id, name: t.name, category: t.category, description: t.description, tasks: tasksToText(t.tasks), docsRequired: docsToText(t.documents, true), docsOptional: docsToText(t.documents, false) })
                      }
                    >
                      {d.common.edit}
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={d.common.delete} onClick={() => confirm(d.tasks.deleteConfirm) && call(t.id, () => api(`/api/admin/templates/${t.id}`, { method: "DELETE" }))}>
                      <Trash2 className="size-4 text-slate-500" />
                    </Button>
                  </div>
                </div>
                <ol className="mt-2 list-inside list-decimal space-y-0.5 text-sm text-slate-700">
                  {t.tasks.map((x, i) => (
                    <li key={i} className="bidi-auto">
                      {x.title}
                      {x.requiresClientAction && <Badge tone="warning" className="ms-1.5">{d.tasks.requiresClient}</Badge>}
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
                    {SERVICE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {d.categories[c]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={d.tasks.description}>{(p) => <Input {...p} value={tpl.description} onChange={(e) => setTpl({ ...tpl, description: e.target.value })} />}</Field>
              <Field label={d.settingsPage.templateTasks}>{(p) => <Textarea {...p} value={tpl.tasks} rows={6} onChange={(e) => setTpl({ ...tpl, tasks: e.target.value })} />}</Field>
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
                            tasks: textToTasks(tpl.tasks),
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
        </TabPanel>

        <TabPanel id="priceList" active={tab === "priceList"} className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 py-4">
              <Field label={d.settingsPage.code} className="w-32">{(p) => <Input {...p} dir="ltr" value={price.code} onChange={(e) => setPrice({ ...price, code: e.target.value })} />}</Field>
              <Field label={d.settingsPage.itemName} className="min-w-48 flex-1">{(p) => <Input {...p} value={price.name} onChange={(e) => setPrice({ ...price, name: e.target.value })} />}</Field>
              <Field label={d.workspace.category}>
                {(p) => (
                  <Select {...p} value={price.category} onChange={(e) => setPrice({ ...price, category: e.target.value })}>
                    {SERVICE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {d.categories[c]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={`${d.settingsPage.price} (${price.currency})`} className="w-32">
                {(p) => <Input {...p} type="number" dir="ltr" min="0" step="0.01" value={price.price} onChange={(e) => setPrice({ ...price, price: e.target.value })} />}
              </Field>
              <Button
                loading={busy === "price"}
                disabled={!price.code.trim() || !price.name.trim() || !price.price}
                onClick={() =>
                  call(
                    "price",
                    () => api("/api/admin/price-list", { body: { code: price.code, name: price.name, category: price.category, unitPriceCents: Math.round(parseFloat(price.price) * 100), currency: price.currency } }),
                    () => setPrice({ ...price, code: "", name: "", price: "" }),
                  )
                }
              >
                <Plus className="size-4" /> {d.settingsPage.newPriceItem}
              </Button>
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{d.admin.col.code}</th>
                  <th className="px-4 py-3 text-start font-medium">{d.settingsPage.itemName}</th>
                  <th className="px-4 py-3 text-start font-medium">{d.workspace.category}</th>
                  <th className="px-4 py-3 text-end font-medium">{d.admin.col.price}</th>
                  <th className="px-4 py-3 text-start font-medium">{d.common.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {prices.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono text-xs" dir="ltr">{p.code}</td>
                    <td className="bidi-auto px-4 py-3">{p.name}</td>
                    <td className="px-4 py-3 text-slate-600">{d.categories[p.category as "other"] ?? p.category}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{formatMoney(p.unitPriceCents, p.currency, locale)}</td>
                    <td className="px-4 py-3">
                      <Checkbox
                        label={p.active ? d.settingsPage.active : d.settingsPage.inactive}
                        checked={p.active}
                        onChange={(e) =>
                          call(p.id, () =>
                            api(`/api/admin/price-list/${p.id}`, { method: "PATCH", body: { code: p.code, name: p.name, category: p.category, unitPriceCents: p.unitPriceCents, currency: p.currency, active: e.target.checked } }),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabPanel>
      </div>
    </div>
  );
}
