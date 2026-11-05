"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { PaymentProviderStatus } from "@/lib/services/payment-settings";

/** Payments page and Settings → Integrations: shows which provider takes payments, and lets an admin connect or disconnect Grow. */
export function GrowConnect({ status, canEdit, className = "mb-6" }: { status: PaymentProviderStatus; canEdit: boolean; className?: string }) {
  const { d, locale } = useI18n();
  const t = d.growConnect;
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ userId: "", pageCode: "", apiKey: "", sandbox: true });
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const g = status.grow;
  const idOk = (s: string) => /^[A-Za-z0-9]{4,64}$/.test(s.trim());

  async function save() {
    setBusy("save");
    try {
      await api("/api/admin/payments/grow", { method: "PUT", body: { ...form, apiKey: form.apiKey.trim() || null } });
      toast("success", form.sandbox ? t.connectedSandbox : t.connectedLive);
      setEditing(false);
      setForm({ userId: "", pageCode: "", apiKey: "", sandbox: true });
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(t.disconnectConfirm)) return;
    setBusy("disconnect");
    try {
      await api("/api/admin/payments/grow", { method: "DELETE" });
      toast("success", t.disconnected);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={className}>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <CreditCard className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t.title}</h2>
              <p className="text-sm text-slate-600">{t.subtitle}</p>
            </div>
          </div>
          {g.connected ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {g.sandbox ? t.statusSandbox : t.statusLive}
            </Badge>
          ) : (
            <Badge tone="muted">{t.statusNotConnected}</Badge>
          )}
        </div>

        <p className="text-sm text-slate-700">{fmt(t.activeProvider, { provider: t.providers[status.active] })}</p>

        {g.connected && !editing && (
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">{t.userId}</dt>
              <dd dir="ltr" className="text-start font-mono">{g.userIdHint}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.pageCode}</dt>
              <dd dir="ltr" className="text-start font-mono">{g.pageCodeHint}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t.source}</dt>
              <dd>{g.source === "env" ? t.sourceEnv : g.connectedAt ? fmt(t.sourceSettings, { date: formatDateTime(g.connectedAt, locale) }) : t.sourceSettingsNoDate}</dd>
            </div>
          </dl>
        )}

        {canEdit && !editing && (
          <div className="flex flex-wrap gap-2">
            {g.source !== "env" && <Button onClick={() => setEditing(true)}>{g.connected ? t.change : t.connect}</Button>}
            {g.source === "settings" && (
              <Button variant="outline" loading={busy === "disconnect"} onClick={disconnect}>
                <Unplug className="size-4" aria-hidden /> {t.disconnect}
              </Button>
            )}
            {g.source === "env" && <p className="text-sm text-slate-600">{t.envManaged}</p>}
          </div>
        )}

        {canEdit && editing && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className="text-sm text-slate-600">{t.help}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t.userId} required>
                {(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />}
              </Field>
              <Field label={t.pageCode} required>
                {(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.pageCode} onChange={(e) => setForm({ ...form, pageCode: e.target.value })} />}
              </Field>
              <Field label={t.apiKey} hint={t.apiKeyHint}>
                {(p) => <Input {...p} dir="ltr" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />}
              </Field>
            </div>
            <div>
              <Checkbox label={t.sandbox} checked={form.sandbox} onChange={(e) => setForm({ ...form, sandbox: e.target.checked })} />
              <p className="ms-6 mt-1 text-xs text-slate-500">{form.sandbox ? t.sandboxHint : t.liveHint}</p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={busy === "save"} disabled={!idOk(form.userId) || !idOk(form.pageCode) || (!!form.apiKey.trim() && !idOk(form.apiKey))}>
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
