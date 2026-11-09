"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type Status = { enabled: boolean; enabledAt: string | null; recoveryLeft: number; required: boolean };

const sixDigits = (s: string) => /^\d{6}$/.test(s.replace(/\s/g, ""));

/** My account → two-step sign-in: turn on (QR code, first code, recovery codes), new recovery codes, turn off. */
export function SecurityCard({ status, mustSetUp }: { status: Status; mustSetUp: boolean }) {
  const { d, locale } = useI18n();
  const t = d.twoFactor;
  const router = useRouter();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manage, setManage] = useState<"new" | "off" | null>(null);

  const run = async <T,>(kind: string, fn: () => Promise<T>, after: (r: T) => void) => {
    setBusy(kind);
    try {
      after(await fn());
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  if (codes)
    return (
      <Card>
        <CardContent className="grid gap-4 py-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <KeyRound className="size-5 text-brand-700" aria-hidden /> {t.recoveryTitle}
          </h2>
          <p className="text-sm text-slate-600">{t.recoveryText}</p>
          <ol className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-4 font-mono text-sm" dir="ltr">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard?.writeText(codes.join("\n")).catch(() => {});
                toast("success", t.copied);
              }}
            >
              <Copy className="size-4" aria-hidden /> {t.copy}
            </Button>
            <Button
              onClick={() => {
                setCodes(null);
                router.refresh();
              }}
            >
              {t.done}
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t.securityTitle}</h2>
              <p className="text-sm text-slate-600">{t.securityHint}</p>
            </div>
          </div>
          {status.enabled ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {t.statusOn}
            </Badge>
          ) : (
            <Badge tone="muted">{t.statusOff}</Badge>
          )}
        </div>

        {!status.enabled && (status.required || mustSetUp) && <Notice tone="warning">{t.requiredNotice}</Notice>}

        {status.enabled && <p className="text-sm text-slate-700">{fmt(t.onSince, { date: formatDate(status.enabledAt, locale), n: status.recoveryLeft })}</p>}

        {!status.enabled && !setup && (
          <div>
            <Button loading={busy === "start"} onClick={() => run("start", () => api<{ secret: string; qrSvg: string }>("/api/account/2fa", { method: "POST" }), setSetup)}>
              {t.turnOn}
            </Button>
          </div>
        )}

        {!status.enabled && setup && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (sixDigits(code))
                void run("confirm", () => api<{ recoveryCodes: string[] }>("/api/account/2fa", { method: "PUT", body: { code: code.replace(/\s/g, "") } }), (r) => {
                  toast("success", t.turnedOn);
                  setCode("");
                  setSetup(null);
                  setCodes(r.recoveryCodes);
                });
            }}
          >
            <div>
              <p className="text-sm font-medium">{t.step1}</p>
              {/* The QR code is generated on the server from the secret below. */}
              <div role="img" aria-label={t.step1} className="mt-2 size-44 rounded-lg border border-slate-200 bg-white p-1 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
              <p className="mt-2 text-xs text-slate-600">{t.step1Manual}</p>
              <p className="mt-1 select-all break-all font-mono text-sm" dir="ltr">
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </p>
            </div>
            <Field label={t.step2} required>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-40 text-center tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} />}
            </Field>
            <div>
              <Button type="submit" loading={busy === "confirm"} disabled={!sixDigits(code)}>
                {t.confirm}
              </Button>
            </div>
          </form>
        )}

        {status.enabled && (
          <div className="flex flex-wrap gap-2">
            <Button variant={manage === "new" ? "secondary" : "outline"} onClick={() => setManage(manage === "new" ? null : "new")}>
              {t.newCodes}
            </Button>
            {!status.required && (
              <Button variant={manage === "off" ? "secondary" : "outline"} onClick={() => setManage(manage === "off" ? null : "off")}>
                {t.turnOff}
              </Button>
            )}
          </div>
        )}

        {status.enabled && manage && (
          <form
            className="grid gap-3 rounded-lg border border-slate-200 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!sixDigits(code)) return;
              const body = { code: code.replace(/\s/g, "") };
              if (manage === "new")
                void run("manage", () => api<{ recoveryCodes: string[] }>("/api/account/2fa/recovery", { body }), (r) => {
                  setCode("");
                  setManage(null);
                  setCodes(r.recoveryCodes);
                });
              else
                void run("manage", () => api("/api/account/2fa", { method: "DELETE", body }), () => {
                  toast("success", t.turnedOff);
                  setCode("");
                  setManage(null);
                  router.refresh();
                });
            }}
          >
            <p className="text-sm text-slate-600">{manage === "new" ? t.newCodesHint : t.turnOffHint}</p>
            <Field label={t.code} required>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-40 text-center tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} />}
            </Field>
            <div>
              <Button type="submit" variant={manage === "off" ? "danger" : "primary"} loading={busy === "manage"} disabled={!sixDigits(code)}>
                {manage === "new" ? t.newCodes : t.turnOff}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
