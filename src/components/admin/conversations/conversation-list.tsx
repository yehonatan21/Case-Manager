"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Reply, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import { ReplyPicker } from "@/components/case/reply-picker";
import type { ConversationRow } from "@/lib/services/conversations";

export function ConversationList({ rows }: { rows: ConversationRow[] }) {
  const { d } = useI18n();
  const t = d.conversations;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return <EmptyState title={t.empty} />;

  const send = async (caseId: string) => {
    setBusy(true);
    try {
      await api(`/api/cases/${caseId}/messages`, { body: { body, kind: "thread" } });
      toast("success", t.sent);
      setBody("");
      setOpen(null);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-card bg-card shadow-card">
      {rows.map((r) => (
        <li key={r.caseId} className={r.fromClient ? "bg-amber-50/40" : undefined}>
          <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="bidi-auto font-semibold text-slate-900">{r.customerName}</span>
                {r.unread && <Badge tone="brand">{t.unread}</Badge>}
                {r.fromClient && <Badge tone="warning">{t.needsReply}</Badge>}
                {r.lastVia === "whatsapp" && (
                  <Badge tone="success">
                    <MessageCircle className="size-3" aria-hidden /> WhatsApp
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                <Link href={`/admin/cases/${r.caseId}?tab=messages`} className="hover:text-brand-700 hover:underline">
                  <span className="bidi-auto">{r.title}</span> · <span dir="ltr">{r.number}</span>
                </Link>
                {" · "}
                {r.assigneeName ?? d.common.unassigned} · {fmt(t.messages, { n: r.messageCount })}
              </p>
              <p className="bidi-auto mt-1.5 line-clamp-2 whitespace-pre-line text-sm text-slate-700">
                {!r.fromClient && <span className="font-medium text-slate-500">{r.lastVia === "automation" ? t.automatic : t.fromTeam}: </span>}
                {r.lastBody}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="whitespace-nowrap text-xs text-slate-500">
                <RelativeTime value={r.lastAt} />
              </span>
              <Button
                size="sm"
                variant={r.fromClient ? "primary" : "outline"}
                aria-expanded={open === r.caseId}
                aria-controls={`reply-${r.caseId}`}
                onClick={() => {
                  setOpen(open === r.caseId ? null : r.caseId);
                  setBody("");
                }}
              >
                <Reply className="size-4" aria-hidden />
                {t.reply}
              </Button>
            </div>
          </div>
          {open === r.caseId && (
            <div id={`reply-${r.caseId}`} className="border-t border-slate-100 bg-slate-50 px-4 py-3">
              <label htmlFor={`reply-body-${r.caseId}`} className="sr-only">
                {fmt(t.replyTo, { name: r.customerName })}
              </label>
              <Textarea id={`reply-body-${r.caseId}`} autoFocus rows={3} className="bidi-auto" value={body} placeholder={fmt(t.replyTo, { name: r.customerName })} onChange={(e) => setBody(e.target.value)} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <ReplyPicker vars={{ client: r.customerName, number: r.number, locale: r.customerLocale }} onPick={(text) => setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${text}` : text))} />
                <Button size="sm" loading={busy} disabled={!body.trim()} onClick={() => send(r.caseId)}>
                  <Send className="size-4 flip-rtl" aria-hidden />
                  {d.messages.send}
                </Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
