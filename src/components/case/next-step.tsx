"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { ACCEPT_ATTRIBUTE } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ClientAction } from "@/lib/services/cases";
import { useActionText } from "./client-actions";

/**
 * The client's case page leads with one thing: the most urgent step, said plainly, with a button that does it.
 * A requested document is uploaded right here (the phone offers its camera); approving, paying and signing open
 * the quote or the document, where the client sees what they agree to. What's left after this is a line
 * ("and 2 more documents after this"), with the full list folded underneath.
 */
export function NextStep({ caseId, actions, done, maxMb, onGo }: { caseId: string; actions: ClientAction[]; done: { title: string; text?: string }; maxMb: number; onGo: (tab: string) => void }) {
  const { d } = useI18n();
  const t = d.caseView;
  const actionText = useActionText();
  const router = useRouter();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (actions.length === 0) {
    return (
      <section aria-labelledby="next-step-title" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <h2 id="next-step-title" className="text-lg font-bold text-emerald-950">
            {done.title}
          </h2>
          {done.text && <p className="mt-0.5 text-emerald-900">{done.text}</p>}
        </div>
      </section>
    );
  }

  const [first, ...rest] = actions;
  const a = actionText(first!);
  const uploadDoc = first!.type === "upload" || first!.type === "upload_many" ? { id: first!.documentId, title: first!.title, note: first!.note } : null;
  // What remains: the other requested documents (when several were asked for), then the other steps.
  const moreDocs = first!.type === "upload_many" ? first!.count - 1 : 0;

  const upload = async (f: File) => {
    if (!uploadDoc) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", f);
    form.set("documentId", uploadDoc.id);
    try {
      await api(`/api/cases/${caseId}/documents`, { form });
      toast("success", fmt(t.uploadedThanks, { title: uploadDoc.title }));
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <section aria-labelledby="next-step-title" className="rounded-2xl border border-signal/30 bg-signal-soft p-5">
      <p className="text-sm font-semibold text-amber-800">{t.nextStepLabel}</p>
      <h2 id="next-step-title" className="bidi-auto mt-1 text-xl font-bold leading-snug text-slate-900">
        {uploadDoc ? uploadDoc.title : a.title}
      </h2>
      {uploadDoc ? (
        uploadDoc.note ? (
          <p className="bidi-auto mt-1 text-slate-700">{fmt(t.whatCounts, { note: uploadDoc.note })}</p>
        ) : null
      ) : (
        a.text && <p className="bidi-auto mt-1 text-slate-700">{a.text}</p>
      )}

      {uploadDoc ? (
        <>
          <input ref={file} type="file" className="hidden" accept={ACCEPT_ATTRIBUTE} aria-hidden tabIndex={-1} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="signal" size="lg" className="mt-4 w-full sm:w-auto" loading={busy} onClick={() => file.current?.click()}>
            <Camera className="size-5" aria-hidden />
            {busy ? d.documents.uploading : t.uploadNow}
          </Button>
          <p className="mt-2 text-xs text-slate-600">{fmt(t.uploadNowHint, { mb: maxMb })}</p>
        </>
      ) : (
        <Button variant="signal" size="lg" className="mt-4 w-full sm:w-auto" onClick={() => onGo(a.tab)}>
          {a.cta}
          <ArrowRight className="size-5 flip-rtl" aria-hidden />
        </Button>
      )}

      {(moreDocs > 0 || rest.length > 0) && (
        <details className="group mt-4 border-t border-signal/20 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 marker:text-amber-800">
            {[moreDocs > 0 && (moreDocs === 1 ? t.docsAfterOne : fmt(t.docsAfter, { n: moreDocs })), rest.length > 0 && (rest.length === 1 ? t.moreAfterOne : fmt(t.moreAfter, { n: rest.length }))]
              .filter(Boolean)
              .join(" · ")}
          </summary>
          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">{t.laterTitle}</p>
            <ul className="space-y-2">
              {first!.type === "upload_many" &&
                first!.titles.slice(1).map((title) => (
                  <li key={title} className="bidi-auto flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm text-slate-800">
                    {title}
                    <button type="button" className="shrink-0 text-xs font-medium text-brand-700 hover:underline" onClick={() => onGo("documents")}>
                      {t.goToUpload}
                    </button>
                  </li>
                ))}
              {rest.map((x, i) => {
                const r = actionText(x);
                return (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm text-slate-800">
                    <span className="bidi-auto">{r.title}</span>
                    <button type="button" className="shrink-0 text-xs font-medium text-brand-700 hover:underline" onClick={() => onGo(r.tab)}>
                      {r.cta}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
