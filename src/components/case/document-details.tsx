"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Sparkles, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { DocFinding } from "@/lib/doc-checks";
import type { DocumentDetails } from "@/lib/db/schema";

const ICON = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const TONE = { error: "text-red-700", warning: "text-amber-800", info: "text-slate-600" } as const;

/** One finding as a sentence, with dates in the user's format. */
export function FindingText({ f }: { f: DocFinding }) {
  const { d, locale } = useI18n();
  const vars = Object.fromEntries(Object.entries(f.vars).map(([k, v]) => [k, /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, locale) : v]));
  const Icon = ICON[f.severity];
  return (
    <span className={`flex items-start gap-1.5 text-sm ${TONE[f.severity]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="bidi-auto">{fmt(d.docChecks.kinds[f.kind], vars)}</span>
    </span>
  );
}

/** Staff: a document's key details (filled by hand or suggested by AI) and what the checks found. */
export function DocumentDetailsForm({ documentId, details, confirmedBy, findings, canEdit, hasFile }: { documentId: string; details: DocumentDetails | null; confirmedBy: string | null; findings: DocFinding[]; canEdit: boolean; hasFile: boolean }) {
  const { d } = useI18n();
  const t = d.docChecks;
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<DocumentDetails>(details ?? {});
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const field = (k: keyof DocumentDetails, label: string, type: "text" | "date" = "text") => (
    <Field label={label}>{(p) => <Input {...p} type={type} dir={type === "date" || k === "idNumber" ? "ltr" : undefined} value={(v[k] as string | undefined) ?? ""} disabled={!canEdit} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>
  );

  const save = async () => {
    setBusy("save");
    try {
      const { source: _ignored, ...body } = v;
      void _ignored;
      await api(`/api/documents/${documentId}/details`, { method: "PUT", body });
      toast("success", t.saved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  const fill = async () => {
    setBusy("ai");
    try {
      const r = await api<{ details: DocumentDetails | null }>(`/api/documents/${documentId}/details/ai`, { method: "POST" });
      if (r.details) {
        setV(r.details);
        setNote(t.aiFilled);
        router.refresh();
      } else setNote(t.aiNothing);
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60" open={findings.some((f) => f.severity === "error")}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800">
        {t.title}
        {findings.length > 0 && <span className="ms-2 rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-900">{findings.length}</span>}
      </summary>
      <div className="space-y-3 border-t border-slate-200 px-3 py-3">
        {findings.length > 0 && (
          <ul className="space-y-1">
            {findings.map((f, i) => (
              <li key={i}>
                <FindingText f={f} />
              </li>
            ))}
          </ul>
        )}
        {note && (
          <p role="status" className="text-sm text-slate-700">
            {note}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {field("docType", t.docType)}
          {field("fullName", t.fullName)}
          {field("idNumber", t.idNumber)}
          {field("birthDate", t.birthDate, "date")}
          {field("issueDate", t.issueDate, "date")}
          {field("expiryDate", t.expiryDate, "date")}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{details?.source === "ai" ? t.aiSuggested : confirmedBy ? fmt(t.confirmedBy, { name: confirmedBy }) : ""}</p>
          {canEdit && (
            <div className="flex gap-2">
              {hasFile && (
                <Button size="sm" variant="outline" loading={busy === "ai"} onClick={fill}>
                  <Sparkles className="size-4" aria-hidden /> {t.fillAi}
                </Button>
              )}
              <Button size="sm" loading={busy === "save"} onClick={save}>
                {t.save}
              </Button>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
