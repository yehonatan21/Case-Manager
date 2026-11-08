"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Mail, Send, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { EmailStatus } from "@/lib/services/email";

type Provider = "smtp" | "resend";

/** Settings → Integrations: the email service for sign-in codes and email updates. */
export function EmailConnect({ status, adminEmail }: { status: EmailStatus; adminEmail: string }) {
  const { d, locale } = useI18n();
  const t = d.emailConnect;
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | null>(null);
  const [form, setForm] = useState({
    provider: (status.provider ?? "smtp") as Provider,
    host: status.host ?? "",
    port: String(status.port ?? 587),
    secure: status.secure,
    username: status.username ?? "",
    password: "",
    apiKey: "",
    fromAddress: status.fromAddress ?? "",
    fromName: status.fromName ?? "",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const keep = status.connected && status.provider === form.provider;
  const valid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.fromAddress.trim()) &&
    (form.provider === "smtp" ? form.host.trim().includes(".") && Number(form.port) > 0 : keep || /^re_[\w-]{8,}$/.test(form.apiKey.trim()));

  const run = async (kind: "save" | "test" | "disconnect", fn: () => Promise<unknown>, done: string) => {
    setBusy(kind);
    try {
      await fn();
      toast("success", done);
      if (kind !== "test") {
        setEditing(false);
        set({ password: "", apiKey: "" });
        router.refresh();
      }
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    run(
      "save",
      () =>
        api("/api/admin/email", {
          method: "PUT",
          body:
            form.provider === "smtp"
              ? {
                  provider: "smtp",
                  host: form.host.trim(),
                  port: Number(form.port),
                  secure: form.secure,
                  username: form.username.trim(),
                  password: form.password,
                  fromAddress: form.fromAddress.trim(),
                  fromName: form.fromName.trim() || null,
                }
              : {
                  provider: "resend",
                  apiKey: form.apiKey.trim(),
                  fromAddress: form.fromAddress.trim(),
                  fromName: form.fromName.trim() || null,
                },
        }),
      t.connected,
    );

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <Mail className="size-5" aria-hidden />
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
            <Badge tone={status.fallback === "env_smtp" ? "info" : "muted"}>{status.fallback === "env_smtp" ? t.statusEnv : t.statusConsole}</Badge>
          )}
        </div>

        {!status.connected && !editing && <p className="text-sm text-slate-600">{status.fallback === "env_smtp" ? t.envHint : t.consoleHint}</p>}

        {status.connected && !editing && (
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-600">{t.provider}</dt>
              <dd>{status.provider === "resend" ? t.providers.resend : "SMTP"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">{status.provider === "resend" ? t.key : t.server}</dt>
              <dd dir="ltr" className="text-start font-mono text-xs">
                {status.provider === "resend" ? status.keyHint : `${status.host}:${status.port}${status.username ? ` · ${status.username}` : ""}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">{t.sender}</dt>
              <dd className="bidi-auto">
                {status.fromName && <span>{status.fromName} </span>}
                <span dir="ltr">&lt;{status.fromAddress}&gt;</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">{t.since}</dt>
              <dd>{status.connectedAt ? formatDateTime(status.connectedAt, locale) : "—"}</dd>
            </div>
          </dl>
        )}

        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>{status.connected ? t.change : t.connect}</Button>
            {status.connected && (
              <>
                <Button variant="outline" loading={busy === "test"} onClick={() => run("test", () => api("/api/admin/email", { method: "POST" }), fmt(t.testSent, { email: adminEmail }))}>
                  <Send className="size-4" aria-hidden /> {t.test}
                </Button>
                <Button
                  variant="outline"
                  loading={busy === "disconnect"}
                  onClick={() => {
                    if (window.confirm(t.disconnectConfirm)) void run("disconnect", () => api("/api/admin/email", { method: "DELETE" }), t.disconnected);
                  }}
                >
                  <Unplug className="size-4" aria-hidden /> {t.disconnect}
                </Button>
              </>
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
            <Field label={t.provider}>
              {(p) => (
                <Select {...p} value={form.provider} onChange={(e) => set({ provider: e.target.value as Provider })}>
                  <option value="smtp">{t.providers.smtp}</option>
                  <option value="resend">{t.providers.resend}</option>
                </Select>
              )}
            </Field>
            {form.provider === "smtp" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
                  <Field label={t.host} required>
                    {(p) => <Input {...p} dir="ltr" placeholder="smtp.gmail.com" autoComplete="off" spellCheck={false} value={form.host} onChange={(e) => set({ host: e.target.value })} />}
                  </Field>
                  <Field label={t.port} required>
                    {(p) => (
                      <Input
                        {...p}
                        dir="ltr"
                        inputMode="numeric"
                        value={form.port}
                        onChange={(e) => {
                          const port = e.target.value.replace(/\D/g, "").slice(0, 5);
                          set({
                            port,
                            ...(port === "465" ? { secure: true } : port === "587" ? { secure: false } : {}),
                          });
                        }}
                      />
                    )}
                  </Field>
                </div>
                <div>
                  <Checkbox label={t.secure} checked={form.secure} onChange={(e) => set({ secure: e.target.checked })} />
                  <p className="ms-6 mt-1 text-xs text-slate-600">{t.secureHint}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.username}>{(p) => <Input {...p} dir="ltr" autoComplete="off" spellCheck={false} value={form.username} onChange={(e) => set({ username: e.target.value })} />}</Field>
                  <Field label={t.password} hint={keep ? t.keep : t.passwordHint}>
                    {(p) => <Input {...p} dir="ltr" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} />}
                  </Field>
                </div>
              </>
            ) : (
              <Field label={t.apiKey} required={!keep} hint={keep ? t.keep : undefined}>
                {(p) => <Input {...p} dir="ltr" type="password" autoComplete="off" placeholder="re_…" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.fromAddress} required hint={t.fromAddressHint}>
                {(p) => <Input {...p} dir="ltr" type="email" autoComplete="off" value={form.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} />}
              </Field>
              <Field label={t.fromName}>{(p) => <Input {...p} value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} />}</Field>
            </div>
            <p className="text-sm text-slate-600">{t.saveHint}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === "save"} disabled={!valid}>
                {t.save}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                {t.cancel}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
