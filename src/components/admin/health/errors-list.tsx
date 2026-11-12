"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bug, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

export type ErrorItem = { id: string; source: "server" | "browser"; message: string; stack: string | null; path: string | null; count: number; firstSeenAt: string; lastSeenAt: string };

/** System health → the errors the app hit, newest first, each markable as fixed. */
export function ErrorsList({ errors }: { errors: ErrorItem[] }) {
  const { d, locale } = useI18n();
  const t = d.errorsList;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (ids: string[] | "all", key: string) => {
    setBusy(key);
    try {
      await api("/api/admin/errors", { body: { ids } });
      toast("success", t.resolved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="errors" aria-labelledby="errors-title" className="mt-8 scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="errors-title" className="flex items-center gap-2 text-base font-semibold">
          <Bug className="size-5 text-slate-600" aria-hidden /> {t.title}
        </h3>
        {errors.length > 1 && (
          <Button size="sm" variant="outline" loading={busy === "all"} onClick={() => resolve("all", "all")}>
            {t.resolveAll}
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t.hint}</p>
      {errors.length === 0 ? (
        <p className="flex items-center gap-2 rounded-card bg-card shadow-card p-4 text-sm text-slate-700">
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> {t.none}
        </p>
      ) : (
        <ul className="space-y-2">
          {errors.map((e) => (
            <li key={e.id} className="rounded-card bg-card shadow-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-mono text-sm text-slate-900" dir="ltr">
                    {e.message}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    <Badge tone={e.source === "server" ? "danger" : "warning"}>{t.sources[e.source]}</Badge>
                    {e.path && (
                      <span dir="ltr" className="font-mono">
                        {e.path}
                      </span>
                    )}
                    <span>{fmt(t.times, { n: e.count })}</span>
                    <span>{fmt(t.seen, { first: formatDateTime(e.firstSeenAt, locale), last: formatDateTime(e.lastSeenAt, locale) })}</span>
                  </p>
                </div>
                <Button size="sm" variant="outline" loading={busy === e.id} onClick={() => resolve([e.id], e.id)}>
                  {t.resolve}
                </Button>
              </div>
              {e.stack && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand-700">{t.details}</summary>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700" dir="ltr">
                    {e.stack}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
