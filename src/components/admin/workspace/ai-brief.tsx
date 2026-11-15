"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import type { WorkspaceData } from "./types";

/** Activity this long after the summary was written counts as "the case changed" (writing it is activity too). */
const STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * The case in two lines, above the work area: what the client wants and the suggested next step, from the saved AI
 * summary, with a refresh when the case has moved on. The full summary (facts, sources, gaps) stays in the AI pane.
 * Shown only when the client agreed to AI.
 */
export function AiBrief({ c }: { c: WorkspaceData }) {
  const { d } = useI18n();
  const t = d.aiBrief;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (c.customer?.aiConsent === false) return null;
  const s = c.aiSummary;
  const stale = !!s && new Date(c.lastActivityAt).getTime() - new Date(s.generated_at).getTime() > STALE_AFTER_MS;
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/ai/case-summary", { body: { caseId: c.id } });
      router.refresh();
    } catch (e) {
      setError(`${d.copilot.failed} (${errorText(e, d)})`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="ai-brief-title" className="mb-4 rounded-lg bg-card px-4 py-3 text-sm ring-1 ring-slate-200" data-ai-brief>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="ai-brief-title" className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Sparkles className="size-3.5 text-brand-700" aria-hidden />
          {t.title}
          {s && (
            <span className="font-normal text-slate-500">
              · <RelativeTime value={s.generated_at} />
              {stale && <> · {t.stale}</>}
            </span>
          )}
        </h2>
        {(!s || stale) && (
          <Button variant="secondary" size="sm" onClick={generate} loading={busy}>
            {!busy && <RefreshCw className="size-4" aria-hidden />}
            {busy ? t.generating : s ? t.refresh : t.generate}
          </Button>
        )}
      </div>
      {s ? (
        <dl className="mt-2 grid gap-x-6 gap-y-2 md:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">{t.wants}</dt>
            <dd className="bidi-auto text-slate-900">{s.what_client_wants}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">{t.next}</dt>
            <dd className="bidi-auto font-medium text-slate-900">{s.recommended_next_step}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-slate-600">{t.none}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
