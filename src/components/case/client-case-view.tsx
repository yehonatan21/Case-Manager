"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CalendarPlus, CheckCircle2, MessageSquare, PartyPopper, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { CLIENT_STATUS } from "@/lib/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, Notice } from "@/components/ui/misc";
import { TabList, TabPanel } from "@/components/ui/tabs";
import { CaseStatusBadge } from "@/components/app/status";
import { Timeline, type TimelineEvent } from "@/components/app/timeline";
import { api } from "@/lib/client-api";
import { ProgressTrack } from "./progress-track";
import { MessageThread, type ThreadMessage } from "./message-thread";
import { DocumentsPanel, type Doc } from "./documents-panel";
import { MeetingsPanel, type MeetingItem } from "./meetings-panel";
import { ClientQuotePanel, type ClientQuote, type ClientPayment, type CheckoutInfo } from "./client-quote-panel";
import { useActionText } from "./client-actions";
import type { ClientAction } from "@/lib/services/cases";
import type { CaseStatus } from "@/lib/db/schema";

export type ClientCaseData = {
  id: string;
  number: string;
  title: string;
  description: string;
  goal: string;
  status: CaseStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  assignee: { name: string } | null;
  customerName: string;
  checkout: CheckoutInfo;
  actions: ClientAction[];
  events: TimelineEvent[];
  messages: ThreadMessage[];
  documents: Doc[];
  quotes: ClientQuote[];
  payments: ClientPayment[];
  meetings: MeetingItem[];
  meetingDurations: number[];
};

const TABS = ["overview", "messages", "documents", "meetings", "quote"] as const;
type Tab = (typeof TABS)[number];

export function ClientCaseView({ c, userId, initialTab, submitted, payment, maxMb }: { c: ClientCaseData; userId: string; initialTab?: string; submitted: boolean; payment?: string; maxMb: number }) {
  const { d, locale } = useI18n();
  const actionText = useActionText();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "overview");

  const go = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    url.searchParams.delete("payment");
    url.searchParams.delete("submitted");
    window.history.replaceState(null, "", url.toString());
    document.getElementById("case-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Mark the case (and its notifications) as read when viewed.
  useEffect(() => {
    void api(`/api/cases/${c.id}/read`, { body: {} }).catch(() => {});
  }, [c.id, c.messages.length]);

  const clientStatus = CLIENT_STATUS[c.status];
  const lastPayment = c.payments[0];

  let paymentNotice: React.ReactNode = null;
  if (payment === "success") {
    paymentNotice =
      lastPayment?.status === "succeeded" ? (
        <Notice tone="success">{d.caseView.paymentConfirmed}</Notice>
      ) : lastPayment?.status === "failed" ? (
        <Notice tone="danger">{d.caseView.paymentFailed}</Notice>
      ) : (
        <Notice tone="info">{d.caseView.paymentPending}</Notice>
      );
  } else if (payment === "cancelled") {
    paymentNotice = <Notice tone="warning">{d.caseView.paymentCancelled}</Notice>;
  } else if (lastPayment?.status === "failed" && c.status === "awaiting_payment") {
    paymentNotice = <Notice tone="danger">{d.caseView.paymentFailed}</Notice>;
  }

  return (
    <div className="space-y-6">
      {submitted && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-emerald-900">
            <PartyPopper className="size-5" aria-hidden />
            {d.submitted.title}
          </p>
          <p className="mt-1 text-emerald-900">{fmt(d.submitted.text, { number: c.number })}</p>
          <p className="mt-1 text-sm text-emerald-800">{d.submitted.next}</p>
        </div>
      )}
      {paymentNotice}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-slate-500" dir="auto">
            {fmt(d.caseView.caseNumber, { number: c.number })} · {formatDate(c.createdAt, locale)}
          </p>
          <h1 className="bidi-auto mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{c.title}</h1>
          <p className="mt-2 text-base font-medium text-brand-800">{d.status.clientHeadline[clientStatus]}</p>
        </div>
        <CaseStatusBadge status={c.status} audience="client" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {/* What needs to be done now — the next step is emphasised, not just the status */}
          <Card className={c.actions.length ? "border-amber-300 ring-1 ring-amber-200" : undefined}>
            <CardHeader>
              <CardTitle>{d.caseView.whatNow}</CardTitle>
            </CardHeader>
            <CardContent>
              {c.actions.length === 0 ? (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                  <div>
                    <p className="font-medium text-slate-800">{c.status === "completed" || c.status === "closed" ? d.caseView.processComplete : d.caseView.nothingNeeded}</p>
                    {c.status !== "completed" && c.status !== "closed" && <p className="text-sm text-slate-600">{d.caseView.nothingNeededText}</p>}
                  </div>
                </div>
              ) : (
                <ul className="space-y-3">
                  {c.actions.map((a, i) => {
                    const t = actionText(a);
                    return (
                      <li key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <t.icon className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{t.title}</p>
                            {t.text && <p className="bidi-auto text-sm text-slate-700">{t.text}</p>}
                          </div>
                        </div>
                        <Button onClick={() => go(t.tab as Tab)} size={i === 0 ? "md" : "sm"} variant={i === 0 ? "primary" : "outline"}>
                          {t.cta}
                          <ArrowRight className="size-4 flip-rtl" aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Progress */}
          {clientStatus !== "cancelled" && clientStatus !== "declined" && (
            <Card>
              <CardHeader>
                <CardTitle>{d.caseView.progressTitle}</CardTitle>
              </CardHeader>
              <CardContent className="py-5">
                <ProgressTrack status={c.status} />
              </CardContent>
            </Card>
          )}

          <div id="case-tabs" className="scroll-mt-20">
            <TabList
              label={c.title}
              value={tab}
              onChange={(t) => go(t as Tab)}
              tabs={[
                { id: "overview", label: d.caseView.tabs.overview },
                { id: "messages", label: d.caseView.tabs.messages },
                { id: "documents", label: d.caseView.tabs.documents },
                { id: "meetings", label: d.meetings.tab },
                { id: "quote", label: d.caseView.tabs.quote },
              ]}
            />
            <div className="pt-5">
              <TabPanel id="overview" active={tab === "overview"} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{d.caseView.requestDetails}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {c.goal && (
                      <p>
                        <span className="font-medium text-slate-800">{d.caseView.goal}: </span>
                        <span className="bidi-auto text-slate-700">{c.goal}</span>
                      </p>
                    )}
                    <p className="bidi-auto whitespace-pre-line leading-relaxed text-slate-700">{c.description}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{d.caseView.timelineTitle}</CardTitle>
                  </CardHeader>
                  <CardContent className="py-5">
                    <Timeline events={c.events} audience="client" />
                  </CardContent>
                </Card>
              </TabPanel>
              <TabPanel id="messages" active={tab === "messages"}>
                <Card>
                  <CardContent className="py-5">
                    <MessageThread caseId={c.id} messages={c.messages} currentUserId={userId} kind="thread" canPost={c.status !== "closed"} />
                  </CardContent>
                </Card>
              </TabPanel>
              <TabPanel id="documents" active={tab === "documents"}>
                <DocumentsPanel caseId={c.id} docs={c.documents} mode="client" canEdit={false} maxMb={maxMb} signerName={c.checkout?.payerName ?? ""} />
              </TabPanel>
              <TabPanel id="meetings" active={tab === "meetings"}>
                <MeetingsPanel
                  caseId={c.id}
                  mode="client"
                  meetings={c.meetings}
                  durations={c.meetingDurations}
                  canBook={!["completed", "closed", "cancelled", "declined"].includes(c.status)}
                  currentUserId={userId}
                />
              </TabPanel>
              <TabPanel id="quote" active={tab === "quote"}>
                <ClientQuotePanel caseId={c.id} caseStatus={c.status} quotes={c.quotes} payments={c.payments} customerName={c.customerName} checkout={c.checkout} />
              </TabPanel>
            </div>
          </div>
        </div>

        {/* Contact */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{d.caseView.yourContact}</CardTitle>
            </CardHeader>
            <CardContent>
              {c.assignee ? (
                <div className="flex items-center gap-3">
                  <Avatar name={c.assignee.name} className="size-10" />
                  <p className="font-medium text-slate-900">{c.assignee.name}</p>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <UserRound className="size-4" aria-hidden />
                  {d.caseView.noContactYet}
                </p>
              )}
              {!["completed", "closed", "cancelled", "declined"].includes(c.status) && (
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => go("meetings")}>
                  <CalendarPlus className="size-4" aria-hidden /> {d.meetings.book}
                </Button>
              )}
              <Button variant="outline" className="mt-4 w-full" onClick={() => go("messages")}>
                <MessageSquare className="size-4" aria-hidden />
                {d.caseView.sendMessage}
              </Button>
            </CardContent>
          </Card>
          <p className="px-1 text-xs text-slate-500">{fmt(d.portal.lastUpdate, { date: formatDate(c.updatedAt, locale) })}</p>
        </aside>
      </div>
    </div>
  );
}
