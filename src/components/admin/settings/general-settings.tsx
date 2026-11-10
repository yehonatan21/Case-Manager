"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import type { AppSettings } from "@/lib/services/settings";
import { useSave } from "./use-save";

/** Settings → General: the office's details, quotes and meetings defaults, follow-ups, security, accessibility. */
export function GeneralSettings({ settings }: { settings: AppSettings }) {
  const { d } = useI18n();
  const { busy, call } = useSave();
  const [s, setS] = useState(settings);
  const [durationsText, setDurationsText] = useState(settings.meeting_durations.join(", "));
  return (
    <Card className="max-w-2xl">
      <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
        <Field label={d.settingsPage.companyName}>{(p) => <Input {...p} value={s.company.name} onChange={(e) => setS({ ...s, company: { ...s.company, name: e.target.value } })} />}</Field>
        <Field label={d.settingsPage.companyEmail}>
          {(p) => <Input {...p} dir="ltr" value={s.company.email} onChange={(e) => setS({ ...s, company: { ...s.company, email: e.target.value } })} />}
        </Field>
        <Field label={d.settingsPage.companyPhone}>
          {(p) => <Input {...p} dir="ltr" value={s.company.phone} onChange={(e) => setS({ ...s, company: { ...s.company, phone: e.target.value } })} />}
        </Field>
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
        <Field label={d.settingsPage.quoteValidity}>
          {(p) => <Input {...p} type="number" dir="ltr" value={s.quote_validity_days} onChange={(e) => setS({ ...s, quote_validity_days: Number(e.target.value) })} />}
        </Field>
        <Field label={d.settingsPage.sla}>
          {(p) => <Input {...p} type="number" dir="ltr" value={s.first_response_sla_hours} onChange={(e) => setS({ ...s, first_response_sla_hours: Number(e.target.value) })} />}
        </Field>
        <Field label={d.settingsPage.questionLimit}>
          {(p) => <Input {...p} type="number" dir="ltr" value={s.intake_question_limit} onChange={(e) => setS({ ...s, intake_question_limit: Number(e.target.value) })} />}
        </Field>
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
                const list = e.target.value
                  .split(/[,\s]+/)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n >= 15 && n <= 240);
                if (list.length) setS({ ...s, meeting_durations: [...new Set(list)].slice(0, 4) });
              }}
            />
          )}
        </Field>
        <Field label={d.meetings.buffer}>
          {(p) => <Input {...p} type="number" dir="ltr" min={0} max={120} value={s.meeting_buffer_minutes} onChange={(e) => setS({ ...s, meeting_buffer_minutes: Number(e.target.value) })} />}
        </Field>
        <Field label={d.meetings.notice}>
          {(p) => <Input {...p} type="number" dir="ltr" min={0} max={168} value={s.meeting_min_notice_hours} onChange={(e) => setS({ ...s, meeting_min_notice_hours: Number(e.target.value) })} />}
        </Field>
        <Field label={d.meetings.horizon}>
          {(p) => <Input {...p} type="number" dir="ltr" min={1} max={90} value={s.meeting_horizon_days} onChange={(e) => setS({ ...s, meeting_horizon_days: Number(e.target.value) })} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label={d.meetings.officeAddress}>{(p) => <Input {...p} value={s.meeting_office_address} onChange={(e) => setS({ ...s, meeting_office_address: e.target.value })} />}</Field>
        </div>
        <h3 className="sm:col-span-2 mt-2 border-t border-slate-100 pt-4 text-sm font-semibold">{d.followups.title}</h3>
        <Field label={d.followups.clientDays} hint={d.followups.hint}>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={0}
              max={60}
              value={s.quote_followup_client_days}
              onChange={(e) => setS({ ...s, quote_followup_client_days: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })}
            />
          )}
        </Field>
        <Field label={d.followups.staffDays} hint={d.followups.hint}>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={0}
              max={60}
              value={s.quote_followup_staff_days}
              onChange={(e) => setS({ ...s, quote_followup_staff_days: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })}
            />
          )}
        </Field>
        <h3 className="sm:col-span-2 mt-2 border-t border-slate-100 pt-4 text-sm font-semibold">{d.twoFactor.securityTitle}</h3>
        <div className="sm:col-span-2">
          <Checkbox label={d.twoFactor.requireLabel} checked={s.require_staff_2fa} onChange={(e) => setS({ ...s, require_staff_2fa: e.target.checked })} />
          <p className="ms-6 mt-1 text-xs text-slate-600">{d.twoFactor.requireHint}</p>
        </div>
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
          {(p) => (
            <Input {...p} dir="ltr" type="tel" value={s.accessibility_contact.phone} onChange={(e) => setS({ ...s, accessibility_contact: { ...s.accessibility_contact, phone: e.target.value } })} />
          )}
        </Field>
        <Field label={d.settingsPage.a11yEmail}>
          {(p) => (
            <Input {...p} dir="ltr" type="email" value={s.accessibility_contact.email} onChange={(e) => setS({ ...s, accessibility_contact: { ...s.accessibility_contact, email: e.target.value } })} />
          )}
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
  );
}
