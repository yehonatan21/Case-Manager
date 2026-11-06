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
import { useCategories } from "@/components/app/categories";
import type { AppSettings } from "@/lib/services/settings";
import type { ServiceTemplateDocument, ServiceTemplateStage, ServiceTemplateTask, UserRole } from "@/lib/db/schema";
import { formatWorkPlan, parseWorkPlan } from "@/lib/work-plan";

type Staff = { id: string; name: string; email: string; role: UserRole; status: "active" | "invited" | "disabled" };
type Template = { id: string; name: string; category: string; description: string; tasks: ServiceTemplateTask[]; stages?: ServiceTemplateStage[]; documents: ServiceTemplateDocument[]; active: boolean };
type Price = { id: string; code: string; name: string; category: string; unitPriceCents: number; currency: string; active: boolean };

const STAFF_ROLES: UserRole[] = ["admin", "case_manager", "staff", "finance"];

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

export function SettingsTabs({
  initialTab,
  currentUserId,
  settings,
  staff,
  templates,
  prices,
  integrations,
  serviceTypes,
  automation,
}: {
  initialTab?: string;
  currentUserId: string;
  settings: AppSettings;
  staff: Staff[];
  templates: Template[];
  prices: Price[];
  /** Rendered in the Integrations tab (WhatsApp). */
  integrations?: React.ReactNode;
  /** Rendered in the Service types tab. */
  serviceTypes?: React.ReactNode;
  /** Rendered in the Automation tab. */
  automation?: React.ReactNode;
}) {
  const categories = useCategories();
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState(["general", "users", "templates", "serviceTypes", "automation", "priceList", "integrations"].includes(initialTab ?? "") ? initialTab! : "general");
  const [busy, setBusy] = useState<string | null>(null);
  const [s, setS] = useState(settings);
  const [durationsText, setDurationsText] = useState(settings.meeting_durations.join(", "));
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
          ...(serviceTypes ? [{ id: "serviceTypes", label: d.settingsPage.tabs.serviceTypes }] : []),
          ...(automation ? [{ id: "automation", label: d.automation.tab }] : []),
          { id: "priceList", label: d.settingsPage.tabs.priceList },
          ...(integrations ? [{ id: "integrations", label: d.settingsPage.tabs.integrations }] : []),
        ]}
      />
      <div className="pt-5">
        {serviceTypes && (
          <TabPanel id="serviceTypes" active={tab === "serviceTypes"} className="max-w-3xl">
            {serviceTypes}
          </TabPanel>
        )}
        {automation && (
          <TabPanel id="automation" active={tab === "automation"} className="max-w-4xl">
            {automation}
          </TabPanel>
        )}
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
              <h3 className="sm:col-span-2 mt-2 border-t border-slate-100 pt-4 text-sm font-semibold">{d.meetings.settingsTitle}</h3>
              <Field label={d.meetings.durations}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    inputMode="numeric"
                    value={durationsText}
                    onChange={(e) => {
                      setDurationsText(e.target.value);
                      const list = e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 15 && n <= 240);
                      if (list.length) setS({ ...s, meeting_durations: [...new Set(list)].slice(0, 4) });
                    }}
                  />
                )}
              </Field>
              <Field label={d.meetings.buffer}>{(p) => <Input {...p} type="number" dir="ltr" min={0} max={120} value={s.meeting_buffer_minutes} onChange={(e) => setS({ ...s, meeting_buffer_minutes: Number(e.target.value) })} />}</Field>
              <Field label={d.meetings.notice}>{(p) => <Input {...p} type="number" dir="ltr" min={0} max={168} value={s.meeting_min_notice_hours} onChange={(e) => setS({ ...s, meeting_min_notice_hours: Number(e.target.value) })} />}</Field>
              <Field label={d.meetings.horizon}>{(p) => <Input {...p} type="number" dir="ltr" min={1} max={90} value={s.meeting_horizon_days} onChange={(e) => setS({ ...s, meeting_horizon_days: Number(e.target.value) })} />}</Field>
              <div className="sm:col-span-2">
                <Field label={d.meetings.officeAddress}>{(p) => <Input {...p} value={s.meeting_office_address} onChange={(e) => setS({ ...s, meeting_office_address: e.target.value })} />}</Field>
              </div>
              <h3 className="sm:col-span-2 mt-2 border-t border-slate-100 pt-4 text-sm font-semibold">{d.followups.title}</h3>
              <Field label={d.followups.clientDays} hint={d.followups.hint}>
                {(p) => <Input {...p} type="number" dir="ltr" min={0} max={60} value={s.quote_followup_client_days} onChange={(e) => setS({ ...s, quote_followup_client_days: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })} />}
              </Field>
              <Field label={d.followups.staffDays} hint={d.followups.hint}>
                {(p) => <Input {...p} type="number" dir="ltr" min={0} max={60} value={s.quote_followup_staff_days} onChange={(e) => setS({ ...s, quote_followup_staff_days: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })} />}
              </Field>
              <h3 className="sm:col-span-2 mt-2 border-t border-slate-100 pt-4 text-sm font-semibold">{d.settingsPage.a11yTitle}</h3>
              <p className="sm:col-span-2 -mt-2 text-xs text-slate-500">
                {d.settingsPage.a11yHint}{" "}
                <a href="/accessibility" target="_blank" rel="noopener" className="font-medium text-brand-700 underline">
                  {d.settingsPage.a11yView}
                </a>
              </p>
              <Field label={d.settingsPage.a11yName}>
                {(p) => <Input {...p} value={s.accessibility_contact.name} onChange={(e) => setS({ ...s, accessibility_contact: { ...s.accessibility_contact, name: e.target.value } })} />}
              </Field>
              <Field label={d.settingsPage.a11yPhone}>
                {(p) => <Input {...p} dir="ltr" type="tel" value={s.accessibility_contact.phone} onChange={(e) => setS({ ...s, accessibility_contact: { ...s.accessibility_contact, phone: e.target.value } })} />}
              </Field>
              <Field label={d.settingsPage.a11yEmail}>
                {(p) => <Input {...p} dir="ltr" type="email" value={s.accessibility_contact.email} onChange={(e) => setS({ ...s, accessibility_contact: { ...s.accessibility_contact, email: e.target.value } })} />}
              </Field>
              <Field label={d.settingsPage.a11yDays} hint={d.settingsPage.a11yDaysHint}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={0}
                    max={60}
                    value={s.accessibility_contact.response_days}
                    onChange={(e) => setS({ ...s, accessibility_contact: { ...s.accessibility_contact, response_days: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) } })}
                  />
                )}
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
                      {categories.label(t.category)} {!t.active && <Badge tone="muted">{d.settingsPage.inactive}</Badge>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setTpl({ id: t.id, name: t.name, category: t.category, description: t.description, tasks: formatWorkPlan(t.stages ?? [], t.tasks, locale === "he" ? "צוות" : "team"), docsRequired: docsToText(t.documents, true), docsOptional: docsToText(t.documents, false) })
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
        </TabPanel>

        <TabPanel id="priceList" active={tab === "priceList"} className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 py-4">
              <Field label={d.settingsPage.code} className="w-32">{(p) => <Input {...p} dir="ltr" value={price.code} onChange={(e) => setPrice({ ...price, code: e.target.value })} />}</Field>
              <Field label={d.settingsPage.itemName} className="min-w-48 flex-1">{(p) => <Input {...p} value={price.name} onChange={(e) => setPrice({ ...price, name: e.target.value })} />}</Field>
              <Field label={d.workspace.category}>
                {(p) => (
                  <Select {...p} value={price.category} onChange={(e) => setPrice({ ...price, category: e.target.value })}>
                    {categories.list.map((c) => (
                      <option key={c.key} value={c.key}>
                        {categories.label(c.key)}
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
                    <td className="px-4 py-3 text-slate-600">{categories.label(p.category)}</td>
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
