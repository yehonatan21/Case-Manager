"use client";

import { Badge, type Tone } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import { CLIENT_STATUS, type ClientStatus } from "@/lib/domain";
import type { CaseStatus, DocumentStatus, QuoteStatus, TaskStatus, Urgency } from "@/lib/db/schema";

const internalTone: Record<CaseStatus, Tone> = {
  draft: "muted",
  submitted: "brand",
  under_review: "info",
  awaiting_information: "warning",
  quote_preparation: "info",
  quote_sent: "brand",
  awaiting_payment: "warning",
  active: "success",
  awaiting_client: "warning",
  completed: "success",
  closed: "neutral",
  cancelled: "neutral",
  declined: "danger",
};

const clientTone: Record<ClientStatus, Tone> = {
  received: "brand",
  in_review: "info",
  awaiting_your_info: "warning",
  quote_ready: "brand",
  awaiting_payment: "warning",
  in_progress: "success",
  awaiting_your_action: "warning",
  completed: "success",
  closed: "neutral",
  cancelled: "neutral",
  declined: "danger",
};

export function CaseStatusBadge({ status, audience = "staff" }: { status: CaseStatus; audience?: "staff" | "client" }) {
  const { d } = useI18n();
  if (audience === "client") {
    const cs = CLIENT_STATUS[status];
    return <Badge tone={clientTone[cs]}>{d.status.client[cs]}</Badge>;
  }
  return <Badge tone={internalTone[status]}>{d.status.internal[status]}</Badge>;
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const { d } = useI18n();
  const tone: Record<Urgency, Tone> = { low: "muted", normal: "neutral", high: "warning", urgent: "danger" };
  return <Badge tone={tone[urgency]}>{d.urgency[urgency]}</Badge>;
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { d } = useI18n();
  const tone: Record<DocumentStatus, Tone> = { requested: "warning", uploaded: "info", in_review: "info", approved: "success", needs_new_version: "danger" };
  return <Badge tone={tone[status]}>{d.documentStatus[status]}</Badge>;
}

export function QuoteStatusBadge({ status, expired }: { status: QuoteStatus; expired?: boolean }) {
  const { d } = useI18n();
  const s = expired ? "expired" : status;
  const tone: Record<QuoteStatus, Tone> = { draft: "muted", sent: "brand", clarification_requested: "warning", approved: "success", declined: "danger", expired: "neutral", superseded: "neutral" };
  return <Badge tone={tone[s]}>{d.quoteStatus[s]}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { d } = useI18n();
  const tone: Record<TaskStatus, Tone> = { todo: "neutral", in_progress: "info", waiting: "warning", done: "success", cancelled: "muted" };
  return <Badge tone={tone[status]}>{d.taskStatus[status]}</Badge>;
}
