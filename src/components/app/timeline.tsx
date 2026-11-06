"use client";

import {
  Bot,
  CalendarClock,
  Hourglass,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  FilePlus2,
  FileQuestion,
  FileText,
  Flag,
  Lock,
  MessageCircleQuestion,
  MessageSquareReply,
  Send,
  UserCheck,
  XCircle,
  Megaphone,
  ListChecks,
  RefreshCcw,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { CLIENT_STATUS } from "@/lib/domain";
import type { CaseStatus, DocumentStatus, Urgency } from "@/lib/db/schema";

export type TimelineEvent = {
  id: string;
  type: string;
  visibility: "client" | "internal";
  actorKind: string;
  actorName: string | null;
  data: Record<string, unknown>;
  createdAt: Date | string;
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  case_submitted: Send,
  assigned: UserCheck,
  unassigned: UserCheck,
  status_changed: RefreshCcw,
  activated_without_payment: CircleDollarSign,
  due_date_set: CalendarClock,
  due_date_cleared: CalendarClock,
  waiting_third_party: Hourglass,
  waiting_third_party_done: Hourglass,
  info_requested: MessageCircleQuestion,
  client_responded: MessageSquareReply,
  document_requested: FileQuestion,
  document_uploaded: FilePlus2,
  document_reviewed: FileCheck2,
  quote_sent: FileText,
  quote_approved: CheckCircle2,
  quote_declined: XCircle,
  quote_clarification: MessageCircleQuestion,
  payment_succeeded: CircleDollarSign,
  payment_failed: XCircle,
  task_completed: CheckCircle2,
  tasks_created: ListChecks,
  client_update: Megaphone,
  case_completed: Flag,
  case_closed: Flag,
  ai_summary: Bot,
  urgency_changed: Flag,
};

export function Timeline({ events, audience, empty }: { events: TimelineEvent[]; audience: "client" | "staff"; empty?: string }) {
  const { d, locale } = useI18n();
  const visible = events.filter((e) => !(e.type === "client_update" && e.visibility === "internal" && e.data?.messageId));
  if (visible.length === 0) return <p className="text-sm text-slate-500">{empty ?? d.caseView.timelineEmpty}</p>;

  const label = (e: TimelineEvent) => {
    const tpl = (d.events as Record<string, string>)[e.type] ?? e.type;
    const data = e.data ?? {};
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined) vars[k] = String(v);
    if (e.type === "status_changed" && data.to) {
      const to = data.to as CaseStatus;
      vars.to = audience === "client" ? d.status.client[CLIENT_STATUS[to]] : d.status.internal[to];
    }
    if (e.type === "document_reviewed" && data.status) vars.status = d.documentStatus[data.status as DocumentStatus];
    if (e.type === "urgency_changed" && data.urgency) vars.urgency = d.urgency[data.urgency as Urgency];
    if (e.type === "assigned" && !data.assignee) vars.assignee = "—";
    if (e.type === "due_date_set" && typeof data.dueDate === "string") vars.dueDate = formatDate(data.dueDate, locale);
    if (e.type === "waiting_third_party") vars.note = typeof data.note === "string" && data.note ? data.note : "—";
    if (e.type === "activated_without_payment" && data.reason) vars.reason = d.workspace.activationReasons[data.reason as "other"] ?? String(data.reason);
    return fmt(tpl, vars);
  };

  return (
    <ol className="relative space-y-4 border-s border-slate-200 ps-6">
      {visible.map((e) => {
        const Icon = ICONS[e.type] ?? RefreshCcw;
        const who = e.actorKind === "system" ? d.common.system : e.actorKind === "ai" ? "AI" : e.actorName;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -start-[2.05rem] top-0.5 flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-slate-200">
              <Icon className="size-3.5 text-brand-700" aria-hidden />
            </span>
            <p className="text-sm font-medium text-slate-800">
              {label(e)}
              {audience === "staff" && e.visibility === "internal" && (
                <Lock className="ms-1.5 inline size-3 text-slate-500" aria-label={d.common.internalOnly} />
              )}
            </p>
            {e.type === "activated_without_payment" && typeof e.data?.note === "string" && e.data.note && (
              <p className="bidi-auto mt-1 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{e.data.note}</p>
            )}
            {e.type === "client_update" && typeof e.data?.text === "string" && (
              <p className="bidi-auto mt-1 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{e.data.text}</p>
            )}
            <p className="mt-0.5 text-xs text-slate-500">
              <time dateTime={new Date(e.createdAt).toISOString()}>{formatDateTime(e.createdAt, locale)}</time>
              {who && <> · {who}</>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
