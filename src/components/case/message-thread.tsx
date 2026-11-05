"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Lock, MessageCircle, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Textarea, Checkbox } from "@/components/ui/form";
import { Avatar, Notice } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  senderId: string | null;
  senderName: string | null;
  senderRole: string | null;
  kind: "thread" | "internal_note";
  body: string;
  isInfoRequest: boolean;
  aiRunId: string | null;
  /** "whatsapp" when the client wrote on WhatsApp. */
  via?: string | null;
  createdAt: Date | string;
};

export function MessageThread({
  caseId,
  messages,
  currentUserId,
  kind,
  canPost,
  staffComposer,
  draft,
  onDraftConsumed,
  emptyText,
}: {
  caseId: string;
  messages: ThreadMessage[];
  currentUserId: string;
  kind: "thread" | "internal_note";
  canPost: boolean;
  staffComposer?: boolean;
  /** Text injected from the AI copilot; must be reviewed and sent by a person. */
  draft?: { text: string; runId: string } | null;
  onDraftConsumed?: () => void;
  emptyText?: string;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [infoRequest, setInfoRequest] = useState(false);
  const [aiRunId, setAiRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const list = messages.filter((m) => m.kind === kind);

  useEffect(() => {
    if (draft) {
      setBody(draft.text);
      setAiRunId(draft.runId);
      onDraftConsumed?.();
    }
  }, [draft, onDraftConsumed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [list.length]);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/cases/${caseId}/messages`, { body: { body, kind, isInfoRequest: kind === "thread" && infoRequest, aiRunId } });
      setBody("");
      setInfoRequest(false);
      setAiRunId(null);
      router.refresh();
    } catch (e) {
      setError(errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="max-h-[60vh] min-h-32 space-y-4 overflow-y-auto pe-1">
        {list.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{emptyText ?? (kind === "thread" ? d.messages.empty : d.messages.internalEmpty)}</p>}
        {list.map((m) => {
          const mine = m.senderId === currentUserId;
          const staffSender = m.senderRole && m.senderRole !== "customer";
          return (
            <div key={m.id} className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
              <Avatar name={m.senderName ?? "?"} className={cn(!staffSender && "bg-slate-200 text-slate-700")} />
              <div className={cn("max-w-[85%]", mine && "items-end text-end")}>
                <p className="mb-1 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{mine ? d.common.you : m.senderName}</span>
                  {staffSender && !mine && kind === "thread" && <> · {d.messages.team}</>} · {formatDateTime(m.createdAt, locale)}
                  {m.via === "whatsapp" && (
                    <>
                      {" · "}
                      <span className="inline-flex items-center gap-0.5 align-middle text-emerald-800">
                        <MessageCircle className="size-3" aria-hidden />
                        {d.whatsapp.via}
                      </span>
                    </>
                  )}
                </p>
                <div
                  className={cn(
                    "bidi-auto inline-block whitespace-pre-line rounded-2xl px-4 py-2.5 text-start text-sm leading-relaxed",
                    kind === "internal_note" ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200" : mine ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-800",
                  )}
                >
                  {m.isInfoRequest && (
                    <Badge tone="warning" className="mb-1.5 block w-fit">
                      {d.messages.infoRequestBadge}
                    </Badge>
                  )}
                  {m.body}
                </div>
                {m.aiRunId && staffComposer && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Bot className="size-3" aria-hidden />
                    {fmt(d.messages.aiDrafted, { name: m.senderName ?? "" })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canPost && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {kind === "internal_note" && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-amber-800">
              <Lock className="size-3.5" aria-hidden /> {d.common.internalOnly}
            </p>
          )}
          {aiRunId && (
            <Notice tone="info" className="mb-2">
              {d.messages.reviewBeforeSend}
            </Notice>
          )}
          <label htmlFor={`composer-${kind}`} className="sr-only">
            {kind === "thread" ? d.messages.placeholder : d.messages.internalPlaceholder}
          </label>
          <Textarea
            id={`composer-${kind}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={kind === "thread" ? d.messages.placeholder : d.messages.internalPlaceholder}
            rows={aiRunId ? 7 : 3}
            className="bidi-auto"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            {staffComposer && kind === "thread" ? (
              <div>
                <Checkbox label={d.messages.infoRequest} checked={infoRequest} onChange={(e) => setInfoRequest(e.target.checked)} />
                {infoRequest && <p className="ms-6 mt-0.5 text-xs text-slate-500">{d.messages.infoRequestHint}</p>}
              </div>
            ) : (
              <span />
            )}
            <Button onClick={send} loading={busy} disabled={!body.trim()}>
              <Send className="size-4 flip-rtl" aria-hidden />
              {d.messages.send}
            </Button>
          </div>
          {error && (
            <Notice tone="danger" className="mt-2">
              {error}
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}
