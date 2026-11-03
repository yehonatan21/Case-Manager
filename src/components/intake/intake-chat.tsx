"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, ClipboardList, FileText, Paperclip, Send, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice, TypingDots } from "@/components/ui/misc";
import { ACCEPT_ATTRIBUTE } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { PublicIntake } from "@/app/api/intake/_view";
import { UnderstoodCard } from "./understood-card";

export function IntakeChat({ initial }: { initial: PublicIntake }) {
  const { d } = useI18n();
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages.length, pending, busy]);

  const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant");
  const lastIsAssistant = session.messages[session.messages.length - 1]?.role === "assistant";
  const answered = session.messages.filter((m) => m.role === "user").length;
  const progress = Math.min(1, session.questionCount / Math.max(1, session.questionLimit));

  const send = async (content: string, skipped = false) => {
    const value = content.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setPending(value);
    setText("");
    try {
      const next = await api<PublicIntake>(`/api/intake/${session.id}/message`, {
        body: { content: value, skipped, attachmentIds: attachments.map((a) => a.id) },
      });
      setSession(next);
      setAttachments([]);
    } catch (e) {
      setError(errorText(e, d));
      setText(value);
    } finally {
      setPending(null);
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      await api(`/api/intake/${session.id}/finish`, { body: {} });
    } catch {
      /* the review page falls back to the conversation text */
    }
    router.push(`/intake/${session.id}/review`);
  };

  const retry = async () => {
    setBusy(true);
    try {
      setSession(await api<PublicIntake>(`/api/intake/${session.id}/retry`, { body: {} }));
    } catch (e) {
      setError(errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    try {
      const r = await api<{ documentId: string; name: string }>(`/api/intake/${session.id}/files`, { form });
      setAttachments((a) => [...a, { id: r.documentId, name: r.name }]);
    } catch (e) {
      setError(`${d.intake.uploadFailed}: ${errorText(e, d)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-0 sm:px-4 lg:py-6">
      <section className="flex min-h-[calc(100dvh-4rem)] flex-1 flex-col bg-white sm:rounded-2xl sm:border sm:border-slate-200 lg:min-h-[calc(100dvh-7rem)]" aria-label={d.intake.title}>
        {/* Header */}
        <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900">{d.intake.title}</h1>
              <p className="text-xs text-slate-500">{d.intake.subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 lg:hidden"
                onClick={() => setShowSummary((s) => !s)}
                aria-expanded={showSummary}
              >
                <ClipboardList className="size-4" aria-hidden />
                {showSummary ? d.intake.hideUnderstood : d.intake.showUnderstood}
              </button>
              <Link href="/" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={d.intake.exit}>
                <X className="size-5" />
              </Link>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={session.questionLimit} aria-valuenow={session.questionCount}>
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(session.readyForReview ? 1 : progress) * 100}%` }} />
            </div>
            <span className="shrink-0 text-xs text-slate-500">
              {session.readyForReview ? d.intake.progressDone : fmt(d.intake.progress, { n: Math.max(1, session.questionCount), total: session.questionLimit })}
            </span>
          </div>
          {showSummary && (
            <div className="mt-3 lg:hidden">
              <UnderstoodCard summary={session.summary} />
            </div>
          )}
        </div>

        {/* Conversation */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" aria-relevant="additions">
          {session.messages.map((m) => (
            <div key={m.id} className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "assistant" && (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700" aria-hidden>
                  <Bot className="size-4" />
                </span>
              )}
              <div
                className={cn(
                  "bidi-auto max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
                  m.role === "user" ? "rounded-ee-sm bg-brand-700 text-white" : "rounded-ss-sm bg-slate-100 text-slate-800",
                  m.skipped && "italic opacity-80",
                )}
              >
                {m.content}
                {m.attachmentIds?.length ? (
                  <span className="mt-1 flex items-center gap-1 text-xs opacity-80">
                    <Paperclip className="size-3" aria-hidden /> {m.attachmentIds.length}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex justify-end">
              <div className="bidi-auto max-w-[85%] whitespace-pre-line rounded-2xl rounded-ee-sm bg-brand-700/80 px-4 py-2.5 text-[15px] text-white">{pending}</div>
            </div>
          )}
          {busy && (
            <div className="flex gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-brand-700" aria-hidden>
                <Bot className="size-4" />
              </span>
              <div className="rounded-2xl rounded-ss-sm bg-slate-100 px-4 py-3">
                <TypingDots label={d.intake.typing} />
              </div>
            </div>
          )}

          {session.aiFailed && !busy && (
            <Notice
              tone="warning"
              title={d.intake.aiErrorTitle}
              action={
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <Button size="sm" variant="outline" onClick={retry}>
                    {d.common.retry}
                  </Button>
                  <ButtonLink size="sm" href={`/intake/${session.id}/review`}>
                    {d.intake.aiErrorAction}
                  </ButtonLink>
                </div>
              }
            >
              {d.intake.aiErrorText}
            </Notice>
          )}

          {session.readyForReview && !busy && !session.aiFailed && (
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
              <p className="font-semibold text-brand-900">{d.intake.readyTitle}</p>
              <p className="mt-1 text-sm text-brand-900/80">{d.intake.readyText}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={finish} loading={finishing}>
                  {d.intake.finish}
                  <ArrowRight className="size-4 flip-rtl" aria-hidden />
                </Button>
                <Button variant="outline" onClick={() => inputRef.current?.focus()}>
                  {d.intake.keepAnswering}
                </Button>
              </div>
            </div>
          )}
          {!session.readyForReview && session.questionCount >= session.questionLimit && !busy && (
            <p className="text-center text-xs text-slate-500">{d.intake.limitReached}</p>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="sticky bottom-0 border-t border-slate-100 bg-white px-3 pb-3 pt-2 sm:rounded-b-2xl sm:px-5">
          {error && (
            <Notice tone="danger" className="mb-2">
              {error}
            </Notice>
          )}
          {lastIsAssistant && !busy && !session.aiFailed && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(lastAssistant?.quickReplies ?? []).map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className="rounded-full border border-brand-200 bg-white px-3 py-1 text-sm text-brand-800 hover:bg-brand-50">
                  {q}
                </button>
              ))}
              {!session.readyForReview && (
                <>
                  <button type="button" onClick={() => send(d.intake.dontKnow, true)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
                    {d.intake.dontKnow}
                  </button>
                  <button type="button" onClick={() => send(d.intake.skip, true)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
                    {d.intake.skip}
                  </button>
                </>
              )}
            </div>
          )}
          {attachments.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  <FileText className="size-3.5" aria-hidden /> {a.name}
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex items-end gap-2"
          >
            <input ref={fileRef} type="file" className="hidden" accept={ACCEPT_ATTRIBUTE} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || busy}
              className="mb-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              aria-label={d.intake.attach}
              title={d.intake.attachHint}
            >
              {uploading ? <span className="size-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <Paperclip className="size-5" />}
            </button>
            <label htmlFor="intake-input" className="sr-only">
              {d.intake.placeholder}
            </label>
            <textarea
              id="intake-input"
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder={d.intake.placeholder}
              maxLength={4000}
              disabled={busy}
              className="bidi-auto max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
            />
            <Button type="submit" size="icon" className="mb-0.5 size-10" disabled={!text.trim() || busy} aria-label={d.intake.send}>
              <Send className="size-4 flip-rtl" />
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-snug text-slate-400">{d.intake.disclaimer}</p>
            <div className="flex items-center gap-3">
              <Link href={`/intake/${session.id}/review?manual=1`} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                {d.intake.switchToManual}
              </Link>
              {answered > 0 && !session.readyForReview && (
                <Button size="sm" variant="secondary" onClick={finish} loading={finishing}>
                  {d.intake.finish}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <aside className="hidden w-80 shrink-0 lg:block" aria-label={d.intake.understoodTitle}>
        <div className="sticky top-24">
          <UnderstoodCard summary={session.summary} />
        </div>
      </aside>
    </div>
  );
}
