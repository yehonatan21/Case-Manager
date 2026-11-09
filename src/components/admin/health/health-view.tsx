"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleOff, RefreshCcw, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { RelativeTime } from "@/components/ui/relative-time";
import type { HealthCheck, HealthLevel, RetryKind } from "@/lib/services/health";

const TONE: Record<HealthLevel, Tone> = { ok: "success", warning: "warning", error: "danger", off: "muted" };
const ICON = { ok: CheckCircle2, warning: AlertTriangle, error: XCircle, off: CircleOff } as const;
const BANNER: Record<HealthLevel, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-900",
  off: "border-slate-200 bg-slate-50 text-slate-800",
};

export function HealthView({ level, checks, checkedAt }: { level: HealthLevel; checks: HealthCheck[]; checkedAt: string }) {
  const { d, locale } = useI18n();
  const t = d.health;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<RetryKind | "refresh" | "demo" | null>(null);
  const OverallIcon = ICON[level];

  const retry = async (kind: RetryKind) => {
    setBusy(kind);
    try {
      const r = await api<{ requeued: number; sent: number }>("/api/admin/health/retry", { method: "POST", body: { kind } });
      toast("success", r.requeued ? fmt(t.retried, r) : t.nothingToRetry);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const value = (k: string, v: string | number | boolean | null) => {
    if (v === null || v === "") return "—";
    if (typeof v === "boolean") return v ? d.common.yes : d.common.no;
    if (k === "lastRunAt" || k === "lastWebhookAt" || k === "lastBackupAt" || k === "lastErrorAt") return formatDateTime(String(v), locale);
    return (t.values as Record<string, string>)[String(v)] ?? String(v);
  };
  const when = (v: string | null) => (v ? <RelativeTime value={v} /> : t.never);

  return (
    <div className="space-y-4">
      <div role="status" className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${BANNER[level]}`}>
        <OverallIcon className="size-5 shrink-0" aria-hidden />
        <p className="flex-1 font-semibold">{t.overall[level]}</p>
        <span className="text-xs opacity-80">{fmt(t.checkedAt, { time: formatDateTime(checkedAt, locale) })}</span>
        <Button
          variant="outline"
          size="sm"
          loading={busy === "refresh"}
          onClick={() => {
            setBusy("refresh");
            router.refresh();
            setTimeout(() => setBusy(null), 800);
          }}
        >
          <RefreshCcw className="size-4" aria-hidden />
          {t.refresh}
        </Button>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {checks.map((c) => {
          const Icon = ICON[c.level];
          const facts = Object.entries(c.facts).filter(([, v]) => v !== undefined);
          return (
            <li key={c.id}>
              <Card className="h-full">
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{t.checks[c.id]}</h3>
                    <Badge tone={TONE[c.level]}>
                      <Icon className="size-3.5" aria-hidden />
                      {t.level[c.level]}
                    </Badge>
                  </div>
                  {c.issues.length > 0 && (
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {c.issues.map((i) => (
                        <li key={i} className="flex gap-2">
                          <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${c.level === "error" ? "text-red-600" : "text-amber-600"}`} aria-hidden />
                          <span>{t.issues[i]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(facts.length > 0 || c.stats) && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      {facts.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-slate-500">{(t.facts as Record<string, string>)[k] ?? k}</dt>
                          <dd className="min-w-0 break-words text-slate-800" dir={k === "model" || k === "phone" ? "ltr" : undefined}>
                            {value(k, v)}
                          </dd>
                        </div>
                      ))}
                      {c.stats && (
                        <>
                          <dt className="text-slate-500">{t.stats.lastOk}</dt>
                          <dd className="text-slate-800">{when(c.stats.lastOkAt)}</dd>
                          {c.stats.lastFailedAt && (
                            <>
                              <dt className="text-slate-500">{t.stats.lastFailed}</dt>
                              <dd className="text-slate-800">{when(c.stats.lastFailedAt)}</dd>
                            </>
                          )}
                          {c.stats.failed7d > 0 && (
                            <>
                              <dt className="text-slate-500">{t.stats.failed7d}</dt>
                              <dd className="tabular-nums text-slate-800">{c.stats.failed7d}</dd>
                            </>
                          )}
                          {c.stats.stuck > 0 && (
                            <>
                              <dt className="text-slate-500">{t.stats.stuck}</dt>
                              <dd className="tabular-nums text-slate-800">{c.stats.stuck}</dd>
                            </>
                          )}
                          {c.stats.lastError && (
                            <>
                              <dt className="text-slate-500">{t.stats.lastError}</dt>
                              <dd className="min-w-0 break-words font-mono text-xs text-slate-700" dir="ltr">
                                {c.stats.lastError}
                              </dd>
                            </>
                          )}
                        </>
                      )}
                    </dl>
                  )}
                  {c.issues.includes("demo_data") && (
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === "demo"}
                        onClick={async () => {
                          if (!confirm(t.removeDemoConfirm)) return;
                          setBusy("demo");
                          try {
                            const r = await api<{ users: string[]; cases: number }>("/api/admin/demo-data", { method: "POST" });
                            toast("success", fmt(t.demoRemoved, { users: r.users.length, cases: r.cases }));
                            router.refresh();
                          } catch (e) {
                            toast("error", errorText(e, d));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {t.removeDemo}
                      </Button>
                    </div>
                  )}
                  {c.retry && c.stats && c.stats.failed7d > 0 && (
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" loading={busy === c.retry} onClick={() => retry(c.retry!)}>
                        <RefreshCcw className="size-4" aria-hidden />
                        {t.retry}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
