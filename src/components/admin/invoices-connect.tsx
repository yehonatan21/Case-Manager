"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ReceiptText, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { InvoiceStatus } from "@/lib/services/invoices";

/** Settings → Integrations: connect an invoicing service (Green Invoice / Morning) for receipts and tax invoices. */
export function InvoicesConnect({ status }: { status: InvoiceStatus }) {
  const { d, locale } = useI18n();
  const t = d.invoices;
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [form, setForm] = useState({ apiKeyId: "", apiSecret: "", sandbox: status.connected ? status.sandbox : true, documentType: status.documentType, autoIssue: status.autoIssue, emailClient: status.emailClient });
  const keyOk = (s: string) => /^[\w-]{8,200}$/.test(s.trim());
  const valid = status.connected ? (!form.apiKeyId || keyOk(form.apiKeyId)) && (!form.apiSecret || keyOk(form.apiSecret)) : keyOk(form.apiKeyId) && keyOk(form.apiSecret);

  const save = async () => {
    setBusy("save");
    try {
      await api("/api/admin/invoices", { method: "PUT", body: { provider: "greeninvoice", ...form, apiKeyId: form.apiKeyId.trim(), apiSecret: form.apiSecret.trim() } });
      toast("success", t.connected);
      setEditing(false);
      setForm((f) => ({ ...f, apiKeyId: "", apiSecret: "" }));
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    if (!window.confirm(t.disconnectConfirm)) return;
    setBusy("disconnect");
    try {
      await api("/api/admin/invoices", { method: "DELETE" });
      toast("success", t.disconnected);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <ReceiptText className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t.title}</h2>
              <p className="text-sm text-slate-600">{t.subtitle}</p>
            </div>
          </div>
          {status.connected ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {status.sandbox ? t.statusSandbox : t.statusConnected}
            </Badge>
          ) : (
            <Badge tone="muted">{t.statusNotConnected}</Badge>
          )}
        </div>

        {!status.connected && !editing && <p className="text-sm text-slate-600">{t.notConnectedHint}</p>}

        {status.connected && !editing && (
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">{t.provider}</dt>
              <dd>
                {t.providers.greeninvoice}
                {status.businessName && <span className="text-slate-500"> · {status.businessName}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.keyHint}</dt>
              <dd dir="ltr" className="text-start font-mono">{status.apiKeyIdHint}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.documentType}</dt>
              <dd>{t.documentTypes[status.documentType]}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.mode}</dt>
              <dd>
                {status.autoIssue ? t.autoIssue : "—"}
                {status.connectedAt && <span className="block text-xs text-slate-500">{formatDateTime(status.connectedAt, locale)}</span>}
              </dd>
            </div>
          </dl>
        )}

        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>{status.connected ? t.change : t.connect}</Button>
            {status.connected && (
              <Button variant="outline" loading={busy === "disconnect"} onClick={disconnect}>
                <Unplug className="size-4" aria-hidden /> {t.disconnect}
              </Button>
            )}
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
            <Field label={t.provider}>
              {(p) => (
                <Select {...p} value="greeninvoice" onChange={() => {}}>
                  <option value="greeninvoice">{t.providers.greeninvoice}</option>
                </Select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.apiKeyId} required={!status.connected} hint={status.connected ? fmt(t.apiSecretKeep, {}) : undefined}>
                {(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.apiKeyId} onChange={(e) => setForm({ ...form, apiKeyId: e.target.value })} />}
              </Field>
              <Field label={t.apiSecret} required={!status.connected} hint={status.connected ? t.apiSecretKeep : undefined}>
                {(p) => <Input {...p} dir="ltr" type="password" autoComplete="off" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} />}
              </Field>
            </div>
            <Field label={t.documentType}>
              {(p) => (
                <Select {...p} value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as "320" | "400" })}>
                  {(["320", "400"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t.documentTypes[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid gap-2">
              <Checkbox label={t.autoIssue} checked={form.autoIssue} onChange={(e) => setForm({ ...form, autoIssue: e.target.checked })} />
              <Checkbox label={t.emailClient} checked={form.emailClient} onChange={(e) => setForm({ ...form, emailClient: e.target.checked })} />
              <div>
                <Checkbox label={t.sandbox} checked={form.sandbox} onChange={(e) => setForm({ ...form, sandbox: e.target.checked })} />
                <p className="ms-6 mt-1 text-xs text-slate-500">{form.sandbox ? t.sandboxHint : t.liveHint}</p>
              </div>
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
