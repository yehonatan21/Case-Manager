"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, ClipboardList, Download, FilePlus2, FileText, Lock, PenLine, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice, EmptyState } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DocumentStatusBadge } from "@/components/app/status";
import { useToast } from "@/components/ui/toast";
import { ACCEPT_ATTRIBUTE } from "@/lib/domain";
import { documentChecklist, sameTitle } from "@/lib/checklist";
import type { DocumentStatus, ScanStatusT } from "./types";
import { SignDialog } from "./signature";
import { checkDocuments } from "@/lib/doc-checks";
import { DocumentDetailsForm, FindingText } from "./document-details";
import type { DocumentDetails } from "@/lib/db/schema";

export type DocFile = { id: string; version: number; filename: string; mimeType?: string; sizeBytes: number; scanStatus: ScanStatusT; createdAt: Date | string; uploaderName: string | null };
export type DocSignature = {
  id: string;
  status: "requested" | "signed" | "cancelled";
  note: string | null;
  requestedAt: Date | string;
  fileVersion: number | null;
  signerName: string | null;
  signedAt: Date | string | null;
  method: "typed" | "drawn" | null;
  originalSha256: string | null;
  signedSha256: string | null;
  /** Staff only. */
  ip: string | null;
  userAgent: string | null;
};
export type Doc = {
  id: string;
  title: string;
  status: DocumentStatus;
  visibility: "client" | "internal";
  required: boolean;
  requested: boolean;
  reminderCount: number;
  requestNote: string | null;
  reviewNote: string | null;
  aiAnalysis: Record<string, unknown> | null;
  /** Staff only: the key details for the checks, and who confirmed them. */
  details?: DocumentDetails | null;
  detailsConfirmedBy?: string | null;
  files: DocFile[];
  signature?: DocSignature | null;
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function UploadButton({ caseId, documentId, label, variant = "primary", visibility }: { caseId: string; documentId?: string; label: string; variant?: "primary" | "outline"; visibility?: "client" | "internal" }) {
  const { d } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    if (documentId) form.set("documentId", documentId);
    if (visibility) form.set("visibility", visibility);
    try {
      await api(`/api/cases/${caseId}/documents`, { form });
      toast("success", d.common.saved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept={ACCEPT_ATTRIBUTE} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button size="sm" variant={variant} loading={busy} onClick={() => ref.current?.click()}>
        <Upload className="size-4" aria-hidden />
        {busy ? d.documents.uploading : label}
      </Button>
    </>
  );
}

export type ChecklistTemplate = { id: string; name: string; documents?: { title: string; note?: string; required?: boolean }[] };

/** Progress of the documents requested from the client (required ones count toward "complete"). */
function ChecklistSummary({ docs, mode }: { docs: Doc[]; mode: "client" | "staff" }) {
  const { d } = useI18n();
  const list = documentChecklist(docs);
  if (list.items.length === 0) return null;
  const pct = list.required ? Math.round((list.requiredProvided / list.required) * 100) : 100;
  return (
    <section aria-labelledby="checklist-title" className="rounded-card bg-card shadow-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="checklist-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ClipboardList className="size-4 text-brand-700" aria-hidden />
          {d.checklist.title}
        </h3>
        {list.complete ? (
          <Badge tone="success">
            <CheckCircle2 className="size-3.5" aria-hidden /> {d.checklist.complete}
          </Badge>
        ) : (
          <span className="text-sm text-slate-600">{fmt(d.checklist.progress, { done: list.requiredProvided, total: list.required })}</span>
        )}
      </div>
      {list.required > 0 && (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={d.checklist.title}
          aria-valuemin={0}
          aria-valuemax={list.required}
          aria-valuenow={list.requiredProvided}
          aria-valuetext={fmt(d.checklist.progress, { done: list.requiredProvided, total: list.required })}
        >
          <div className={`h-full rounded-full ${list.complete ? "bg-success" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {list.missing.length > 0 && (
        <p className="mt-3 text-sm text-slate-700">
          {mode === "client" ? d.checklist.missingClient : d.checklist.missingStaff}{" "}
          <span className="bidi-auto font-medium">{list.missing.map((x) => x.title).join(", ")}</span>
        </p>
      )}
      {list.optional > 0 && <p className="mt-1 text-xs text-slate-500">{fmt(d.checklist.optionalCount, { done: list.optionalProvided, total: list.optional })}</p>}
    </section>
  );
}

export function DocumentsPanel({
  caseId,
  docs,
  mode,
  canEdit,
  maxMb,
  checklistTemplates = [],
  signerName = "",
  clientName = "",
  today,
  canSign = true,
}: {
  caseId: string;
  docs: Doc[];
  mode: "client" | "staff";
  canEdit: boolean;
  maxMb: number;
  /** Staff: service templates with a document checklist, the case's category first. */
  checklistTemplates?: ChecklistTemplate[];
  /** Client: their name, prefilled when signing. */
  signerName?: string;
  /** Staff: the client's name and the office's today, for the document checks. */
  clientName?: string;
  today?: string;
  /** Client: false for a company colleague who isn't the owner or signatory. */
  canSign?: boolean;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqTitle, setReqTitle] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reviewDoc, setReviewDoc] = useState<Doc | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [staffVisibility, setStaffVisibility] = useState<"client" | "internal">("client");
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [sigDoc, setSigDoc] = useState<Doc | null>(null);
  const [sigNote, setSigNote] = useState("");
  const [signDoc, setSignDoc] = useState<Doc | null>(null);
  const [templateId, setTemplateId] = useState(checklistTemplates[0]?.id ?? "");
  const [picked, setPicked] = useState<number[] | null>(null);
  const tpl = checklistTemplates.find((t) => t.id === templateId);
  // Already asked for (and not yet approved): shown but not requested again.
  const alreadyAsked = (title: string) => docs.some((x) => x.visibility === "client" && x.status !== "approved" && sameTitle(x.title, title));
  const defaultPick = (t?: ChecklistTemplate) => (t?.documents ?? []).map((x, i) => (alreadyAsked(x.title) ? -1 : i)).filter((i) => i >= 0);
  const selection = picked ?? defaultPick(tpl);

  const requested = docs.filter((x) => x.status === "requested" || x.status === "needs_new_version");
  const others = docs.filter((x) => !requested.includes(x));

  const review = async (doc: Doc, status: "in_review" | "approved" | "needs_new_version", note?: string) => {
    setBusy(doc.id + status);
    try {
      await api(`/api/documents/${doc.id}`, { method: "PATCH", body: { status, note: note ?? null } });
      setReviewDoc(null);
      setReviewNote("");
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const analyze = async (doc: Doc) => {
    setBusy(doc.id + "ai");
    try {
      await api("/api/ai/analyze-document", { body: { documentId: doc.id } });
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const request = async () => {
    setBusy("request");
    try {
      await api(`/api/cases/${caseId}/documents`, { body: { title: reqTitle, note: reqNote || null } });
      setRequestOpen(false);
      setReqTitle("");
      setReqNote("");
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const requestChecklist = async () => {
    setBusy("checklist");
    try {
      const r = await api<{ created: number }>(`/api/cases/${caseId}/documents`, { body: { templateId, only: selection } });
      toast("success", fmt(d.checklist.requested, { n: r.created }));
      setChecklistOpen(false);
      setPicked(null);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const requestSignature = async () => {
    if (!sigDoc) return;
    setBusy("signature");
    try {
      await api(`/api/cases/${caseId}/signatures`, { body: { documentId: sigDoc.id, note: sigNote || null } });
      toast("success", d.signatures.requested);
      setSigDoc(null);
      setSigNote("");
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const cancelSignature = async (doc: Doc) => {
    if (!doc.signature || !window.confirm(d.signatures.cancelConfirm)) return;
    setBusy(doc.id + "cancel-sig");
    try {
      await api(`/api/signatures/${doc.signature.id}`, { method: "DELETE" });
      toast("success", d.signatures.cancelled);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  // Staff: checks across the documents that have details (expiry, names, ID numbers, dates of birth).
  const findings =
    mode === "staff" && today
      ? checkDocuments(
          docs.filter((x) => x.files.length > 0).map((x) => ({ id: x.id, title: x.title, details: x.details ?? null, readable: (x.aiAnalysis as { readable?: boolean } | null)?.readable ?? null })),
          clientName,
          today,
        )
      : [];

  const renderDoc = (doc: Doc) => {
    const latest = doc.files[0];
    const sig = doc.signature ?? null;
    const awaitingSignature = sig?.status === "requested";
    // The current file is the signed copy itself: nothing more to request on it.
    const showsSignedCopy = sig?.status === "signed" && !!latest && latest.version === (sig.fileVersion ?? 0) + 1;
    const canRequestSignature = mode === "staff" && canEdit && !!latest && latest.mimeType === "application/pdf" && doc.visibility === "client" && !awaitingSignature && !showsSignedCopy;
    const analysis = doc.aiAnalysis as null | { readable?: boolean; summary?: string; fields?: { label: string; value: string; confidence: string }[]; notes?: string };
    return (
      <li key={doc.id} className="rounded-lg border border-slate-200 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <FileText className="mt-0.5 size-5 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0">
              <p className="bidi-auto font-medium text-slate-900">{doc.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {/* An optional document still waiting is "optional", not "needed". */}
                {doc.requested && !doc.required && doc.status === "requested" ? (
                  <Badge tone="muted">{d.checklist.optional}</Badge>
                ) : (
                  <DocumentStatusBadge status={doc.status} />
                )}
                {mode === "staff" && doc.visibility === "internal" && (
                  <Badge tone="muted">
                    <Lock className="size-3" aria-hidden />
                    {d.documents.internal}
                  </Badge>
                )}
                {latest && mode === "staff" && (
                  <Badge tone={latest.scanStatus === "clean" ? "success" : "muted"}>{d.scanStatus[latest.scanStatus]}</Badge>
                )}
                {awaitingSignature && (
                  <Badge tone="warning">
                    <PenLine className="size-3" aria-hidden />
                    {mode === "client" ? d.signatures.awaitingClient : d.signatures.awaiting}
                  </Badge>
                )}
                {sig?.status === "signed" && (
                  <Badge tone="success">
                    <PenLine className="size-3" aria-hidden />
                    {d.signatures.signed}
                  </Badge>
                )}
              </div>
              {awaitingSignature && sig.note && <p className="bidi-auto mt-1.5 text-sm text-slate-600">{fmt(d.documents.requestNote, { note: sig.note })}</p>}
              {sig?.status === "signed" && sig.signedAt && (
                <p className="bidi-auto mt-1.5 text-sm text-emerald-800">{fmt(d.signatures.signedBy, { name: sig.signerName ?? "", date: formatDateTime(sig.signedAt, locale) })}</p>
              )}
              {doc.requestNote && <p className="bidi-auto mt-1.5 text-sm text-slate-600">{fmt(d.documents.requestNote, { note: doc.requestNote })}</p>}
              {doc.status === "needs_new_version" && doc.reviewNote && (
                <p className="bidi-auto mt-1.5 text-sm text-red-700">{fmt(d.documents.reviewNote, { note: doc.reviewNote })}</p>
              )}
              {mode === "staff" && latest && (
                <DocumentDetailsForm
                  documentId={doc.id}
                  details={doc.details ?? null}
                  confirmedBy={doc.detailsConfirmedBy ?? null}
                  findings={findings.filter((f) => f.documentId === doc.id)}
                  canEdit={canEdit}
                  hasFile={!!latest}
                />
              )}
              {latest && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {latest.filename} · {kb(latest.sizeBytes)} · {fmt(d.documents.version, { n: latest.version })} ·{" "}
                  {fmt(d.documents.uploadedAt, { date: formatDateTime(latest.createdAt, locale) })}
                  {latest.uploaderName && <> · {latest.uploaderName}</>}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {latest && (
              <a href={`/api/files/${latest.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-card px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Download className="size-4" aria-hidden />
                {d.common.download}
              </a>
            )}
            {mode === "client" && awaitingSignature && latest && !canSign && <span className="text-xs text-slate-600">{d.company.cantSign}</span>}
            {mode === "client" && awaitingSignature && latest && canSign && (
              <Button size="sm" onClick={() => setSignDoc(doc)}>
                <PenLine className="size-4" aria-hidden />
                {d.signatures.review}
              </Button>
            )}
            {canRequestSignature && (
              <Button size="sm" variant="outline" onClick={() => setSigDoc(doc)}>
                <PenLine className="size-4" aria-hidden />
                {d.signatures.request}
              </Button>
            )}
            {mode === "staff" && canEdit && awaitingSignature && (
              <Button size="sm" variant="ghost" loading={busy === doc.id + "cancel-sig"} onClick={() => cancelSignature(doc)}>
                {d.signatures.cancel}
              </Button>
            )}
            {mode === "client" && (doc.status === "requested" || doc.status === "needs_new_version") && (
              <UploadButton caseId={caseId} documentId={doc.id} label={doc.status === "requested" ? d.documents.upload : d.documents.uploadNewVersion} />
            )}
            {mode === "staff" && canEdit && latest && doc.status !== "approved" && (
              <>
                <Button size="sm" variant="secondary" loading={busy === doc.id + "approved"} onClick={() => review(doc, "approved")}>
                  {d.documents.approve}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setReviewDoc(doc)}>
                  {d.documents.requestNew}
                </Button>
              </>
            )}
            {mode === "staff" && canEdit && latest && (
              <Button size="sm" variant="ghost" loading={busy === doc.id + "ai"} onClick={() => analyze(doc)}>
                <Bot className="size-4" aria-hidden />
                {d.documents.analyze}
              </Button>
            )}
          </div>
        </div>
        {mode === "staff" && sig?.status === "signed" && (
          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium">{d.signatures.evidence}</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
              <dt className="text-slate-500">{d.signatures.method}</dt>
              <dd>{sig.method === "drawn" ? d.signatures.methodDrawn : d.signatures.methodTyped}</dd>
              <dt className="text-slate-500">{d.signatures.ip}</dt>
              <dd dir="ltr" className="text-start font-mono">{sig.ip ?? "—"}</dd>
              <dt className="text-slate-500">{d.signatures.device}</dt>
              <dd dir="ltr" className="break-all text-start">{sig.userAgent ?? "—"}</dd>
              <dt className="text-slate-500">{d.signatures.originalFingerprint}</dt>
              <dd dir="ltr" className="break-all text-start font-mono">{sig.originalSha256}</dd>
              <dt className="text-slate-500">{d.signatures.signedFingerprint}</dt>
              <dd dir="ltr" className="break-all text-start font-mono">{sig.signedSha256}</dd>
              <dt className="text-slate-500">{d.signatures.reference}</dt>
              <dd dir="ltr" className="text-start font-mono">{sig.id}</dd>
            </dl>
          </details>
        )}
        {mode === "staff" && doc.files.length > 1 && (
          <details className="mt-3 text-xs text-slate-500">
            <summary className="cursor-pointer">{d.documents.versions} ({doc.files.length})</summary>
            <ul className="mt-1 space-y-1">
              {doc.files.map((f) => (
                <li key={f.id}>
                  <a className="text-brand-700 hover:underline" href={`/api/files/${f.id}`}>
                    v{f.version} · {f.filename}
                  </a>{" "}
                  · {formatDateTime(f.createdAt, locale)}
                </li>
              ))}
            </ul>
          </details>
        )}
        {mode === "staff" && analysis && (
          <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-sm">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-800">
              <Bot className="size-3.5" aria-hidden /> {d.documents.analysis} · {d.common.aiSuggestion}
            </p>
            {analysis.readable === false && <p className="mt-1 text-amber-800">{d.documents.unreadable}</p>}
            {analysis.summary && <p className="bidi-auto mt-1 text-slate-700">{analysis.summary}</p>}
            {!!analysis.fields?.length && (
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {analysis.fields.map((f, i) => (
                  <div key={i} className="flex gap-1.5">
                    <dt className="text-slate-500">{f.label}:</dt>
                    <dd className="bidi-auto font-medium text-slate-800">
                      {f.value} <span className="text-[10px] font-normal text-slate-500">({f.confidence})</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-2 text-[11px] text-slate-500">{d.documents.analysisNote}</p>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <ChecklistSummary docs={docs} mode={mode} />
      {/* Staff: what the document checks found, across the case (errors and warnings; "check AI details" stays on the document). */}
      {mode === "staff" && findings.some((f) => f.severity !== "info") && (
        <div role="region" aria-label={fmt(d.docChecks.summary, { n: findings.filter((f) => f.severity !== "info").length })} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1.5 text-sm font-semibold text-amber-950">{fmt(d.docChecks.summary, { n: findings.filter((f) => f.severity !== "info").length })}</p>
          <ul className="space-y-1">
            {findings
              .filter((f) => f.severity !== "info")
              .map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="bidi-auto text-xs font-medium text-slate-700">{docs.find((x) => x.id === f.documentId)?.title}:</span>
                  <FindingText f={f} />
                </li>
              ))}
          </ul>
        </div>
      )}
      {requested.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">{mode === "client" ? d.documents.requestedTitle : d.documentStatus.requested}</h3>
          <ul className="space-y-2">
            {requested.map(renderDoc)}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{d.documents.title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "staff" && canEdit && (
              <>
                <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
                  <FilePlus2 className="size-4" aria-hidden />
                  {d.documents.requestDocument}
                </Button>
                {checklistTemplates.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPicked(null);
                      setChecklistOpen(true);
                    }}
                  >
                    <ClipboardList className="size-4" aria-hidden />
                    {d.checklist.requestChecklist}
                  </Button>
                )}
                <Select aria-label={d.documents.visibility} value={staffVisibility} onChange={(e) => setStaffVisibility(e.target.value as "client" | "internal")} className="h-8 w-auto text-xs">
                  <option value="client">{d.documents.visibleToClient}</option>
                  <option value="internal">{d.documents.internal}</option>
                </Select>
              </>
            )}
            {(mode === "client" || canEdit) && <UploadButton caseId={caseId} label={d.documents.upload} variant="outline" visibility={mode === "staff" ? staffVisibility : undefined} />}
          </div>
        </div>
        <p className="mb-3 text-xs text-slate-500">{fmt(d.documents.allowed, { size: maxMb })}</p>
        {others.length === 0 ? (
          <EmptyState title={d.documents.empty} className="py-8" />
        ) : (
          <ul className="space-y-2">
            {others.map(renderDoc)}
          </ul>
        )}
      </section>

      <Dialog
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        title={d.checklist.requestChecklist}
        footer={
          <>
            <Button variant="ghost" onClick={() => setChecklistOpen(false)}>
              {d.common.cancel}
            </Button>
            <Button onClick={requestChecklist} loading={busy === "checklist"} disabled={selection.length === 0}>
              {fmt(d.checklist.requestN, { n: selection.length })}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={d.checklist.template}>
            {(p) => (
              <Select
                {...p}
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setPicked(null);
                }}
              >
                {checklistTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">{d.checklist.choose}</legend>
            <ul className="space-y-2">
              {(tpl?.documents ?? []).map((x, i) => {
                const asked = alreadyAsked(x.title);
                return (
                  <li key={i}>
                    <Checkbox
                      checked={!asked && selection.includes(i)}
                      disabled={asked}
                      onChange={(e) => setPicked(e.target.checked ? [...selection, i] : selection.filter((j) => j !== i))}
                      label={
                        <span className="bidi-auto">
                          {x.title}
                          {x.required === false && <span className="text-slate-500"> · {d.checklist.optional}</span>}
                          {asked && <span className="text-slate-500"> · {d.checklist.alreadyRequested}</span>}
                          {x.note && <span className="block text-xs text-slate-500">{x.note}</span>}
                        </span>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <Notice tone="info">{d.checklist.clientNotified}</Notice>
        </div>
      </Dialog>

      <Dialog
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title={d.documents.requestDocument}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRequestOpen(false)}>
              {d.common.cancel}
            </Button>
            <Button onClick={request} loading={busy === "request"} disabled={!reqTitle.trim()}>
              {d.common.send}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={d.documents.docTitle} required>
            {(p) => <Input {...p} value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} />}
          </Field>
          <Field label={d.documents.docNote}>{(p) => <Textarea {...p} value={reqNote} onChange={(e) => setReqNote(e.target.value)} rows={3} />}</Field>
          <Notice tone="info">{d.messages.infoRequestHint}</Notice>
        </div>
      </Dialog>

      <Dialog
        open={!!sigDoc}
        onClose={() => setSigDoc(null)}
        title={fmt(d.signatures.requestTitle, { title: sigDoc?.title ?? "" })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSigDoc(null)}>
              {d.common.cancel}
            </Button>
            <Button loading={busy === "signature"} onClick={requestSignature}>
              <PenLine className="size-4" aria-hidden /> {d.signatures.requestSend}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-slate-600">{d.signatures.requestHint}</p>
          <Field label={d.signatures.requestNote}>{(p) => <Textarea {...p} rows={3} value={sigNote} onChange={(e) => setSigNote(e.target.value)} />}</Field>
        </div>
      </Dialog>
      {signDoc?.signature && signDoc.files[0] && (
        <SignDialog
          key={signDoc.signature.id}
          open
          onClose={() => setSignDoc(null)}
          signatureId={signDoc.signature.id}
          title={signDoc.title}
          fileId={signDoc.files[0].id}
          note={signDoc.signature.note}
          defaultName={signerName}
        />
      )}
      <Dialog
        open={!!reviewDoc}
        onClose={() => setReviewDoc(null)}
        title={d.documents.requestNew}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewDoc(null)}>
              {d.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => reviewDoc && review(reviewDoc, "needs_new_version", reviewNote)} disabled={!reviewNote.trim()} loading={!!busy}>
              {d.documents.requestNew}
            </Button>
          </>
        }
      >
        <Field label={d.documents.reviewNotePrompt} required>
          {(p) => <Textarea {...p} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={3} />}
        </Field>
      </Dialog>
    </div>
  );
}
