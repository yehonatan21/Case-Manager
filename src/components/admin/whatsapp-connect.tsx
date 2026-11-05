"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, MessageCircle, Send, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { WhatsAppStatus } from "@/lib/services/whatsapp";

const empty = { phoneNumberId: "", accessToken: "", appSecret: "", template: "case_update", he: "he", en: "en" };

/** Settings → Integrations: connect the WhatsApp Business number (Meta Cloud API), webhook details, a test message. */
export function WhatsAppConnect({ status, canTest }: { status: WhatsAppStatus; canTest: boolean }) {
  const { d, locale } = useI18n();
  const t = d.whatsappConnect;
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState<"save" | "disconnect" | "test" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const valid =
    /^\d{5,30}$/.test(form.phoneNumberId.trim()) &&
    form.accessToken.trim().length >= 20 &&
    /^[A-Za-z0-9]{16,64}$/.test(form.appSecret.trim()) &&
    /^[a-z0-9_]{1,512}$/.test(form.template.trim()) &&
    /^[a-z]{2,3}(_[A-Z]{2})?$/.test(form.he.trim()) &&
    /^[a-z]{2,3}(_[A-Z]{2})?$/.test(form.en.trim());

  async function run(kind: "save" | "disconnect" | "test", fn: () => Promise<unknown>, success: string) {
    setBusy(kind);
    try {
      await fn();
      toast("success", success);
      router.refresh();
      return true;
    } catch (e) {
      toast("error", errorText(e, d));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = async () => {
    const done = await run(
      "save",
      () =>
        api("/api/admin/whatsapp", {
          method: "PUT",
          body: { phoneNumberId: form.phoneNumberId, accessToken: form.accessToken, appSecret: form.appSecret, template: form.template, templateLanguages: { he: form.he, en: form.en } },
        }),
      t.connected,
    );
    if (done) {
      setEditing(false);
      setForm(empty);
    }
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      /* The value is shown and selectable anyway. */
    }
  };

  const CopyRow = ({ id, label, value }: { id: string; label: string; value: string }) => (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-start font-mono text-xs ring-1 ring-slate-200">
          {value}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={() => copy(id, value)} aria-label={`${t.copy}: ${label}`}>
          <Copy className="size-3.5" aria-hidden /> {copied === id ? t.copied : t.copy}
        </Button>
      </dd>
    </div>
  );

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
              <MessageCircle className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t.title}</h2>
              <p className="text-sm text-slate-600">{t.subtitle}</p>
            </div>
          </div>
          {status.connected ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {t.statusConnected}
            </Badge>
          ) : (
            <Badge tone="muted">{t.statusNotConnected}</Badge>
          )}
        </div>

        {status.connected && !editing && (
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">{t.number}</dt>
              <dd dir="ltr" className="text-start">
                {status.displayPhone ?? status.phoneNumberIdHint}
                {status.name && <span className="text-slate-500"> · {status.name}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.template}</dt>
              <dd dir="ltr" className="text-start font-mono text-xs">
                {status.template} ({status.templateLanguages?.he}, {status.templateLanguages?.en})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.source}</dt>
              <dd>{status.source === "env" ? t.sourceEnv : status.connectedAt ? fmt(t.sourceSettings, { date: formatDateTime(status.connectedAt, locale) }) : ""}</dd>
            </div>
          </dl>
        )}

        {status.connected && !editing && (
          <section aria-labelledby="wa-webhook-title" className="grid gap-3 rounded-lg border border-slate-200 p-4">
            <h3 id="wa-webhook-title" className="text-sm font-semibold">
              {t.webhookTitle}
            </h3>
            <p className="text-sm text-slate-600">{t.webhookHint}</p>
            <dl className="grid gap-3">
              <CopyRow id="url" label={t.webhookUrl} value={status.webhookUrl} />
              {status.verifyToken && <CopyRow id="token" label={t.verifyToken} value={status.verifyToken} />}
            </dl>
          </section>
        )}

        {!editing && status.source !== "env" && (
          <details className="rounded-lg border border-slate-200 p-4 text-sm">
            <summary className="cursor-pointer font-semibold">{t.templateTitle}</summary>
            <p className="mt-2 text-slate-600">{t.templateHint}</p>
            <pre dir="rtl" lang="he" className="mt-3 whitespace-pre-wrap rounded bg-slate-50 p-3 text-start font-sans text-xs ring-1 ring-slate-200">
              {t.templateSampleHe.replace(/\\n/g, "\n")}
            </pre>
            <pre dir="ltr" lang="en" className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 text-start font-sans text-xs ring-1 ring-slate-200">
              {t.templateSampleEn.replace(/\\n/g, "\n")}
            </pre>
          </details>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            {status.source !== "env" && <Button onClick={() => setEditing(true)}>{status.connected ? t.change : t.connect}</Button>}
            {status.connected && (
              <Button variant="outline" loading={busy === "test"} disabled={!canTest} onClick={() => run("test", () => api("/api/admin/whatsapp/test", { body: {} }), t.testQueued)}>
                <Send className="size-4" aria-hidden /> {t.sendTest}
              </Button>
            )}
            {status.source === "settings" && (
              <Button
                variant="outline"
                loading={busy === "disconnect"}
                onClick={() => {
                  if (window.confirm(t.disconnectConfirm)) void run("disconnect", () => api("/api/admin/whatsapp", { method: "DELETE" }), t.disconnected);
                }}
              >
                <Unplug className="size-4" aria-hidden /> {t.disconnect}
              </Button>
            )}
            {status.source === "env" && <p className="text-sm text-slate-600">{t.envManaged}</p>}
            {status.connected && !canTest && <p className="w-full text-xs text-slate-500">{t.testNeedsOptIn}</p>}
          </div>
        )}

        {editing && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className="text-sm text-slate-600">{t.help}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.phoneNumberId} required>
                {(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="off" spellCheck={false} value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} />}
              </Field>
              <Field label={t.appSecret} hint={t.appSecretHint} required>
                {(p) => <Input {...p} dir="ltr" type="password" autoComplete="off" value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} />}
              </Field>
              <div className="sm:col-span-2">
                <Field label={t.accessToken} hint={t.accessTokenHint} required>
                  {(p) => <Input {...p} dir="ltr" type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />}
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={t.templateName} hint={t.templateNameHint} required>
                  {(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} />}
                </Field>
              </div>
              <Field label={t.langHe} required>
                {(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.he} onChange={(e) => setForm({ ...form, he: e.target.value })} />}
              </Field>
              <Field label={t.langEn} required>
                {(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} />}
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={busy === "save"} disabled={!valid}>
                {t.save}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {d.common.cancel}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
