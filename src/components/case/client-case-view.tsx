"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Clock, MessageSquare, PartyPopper, UserRound } from "lucide-react";
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
import { FeedbackCard } from "./feedback-card";
import { ClientQuotePanel, type ClientQuote, type ClientPayment, type CheckoutInfo } from "./client-quote-panel";
import { NextStep } from "./next-step";
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
  /** False for a company colleague who isn't the owner or signatory. */
  canSign?: boolean;
  /** Set when the case was opened for a colleague at the same company. */
  openedFor?: string | null;
  actions: ClientAction[];
  events: TimelineEvent[];
  messages: ThreadMessage[];
  documents: Doc[];
  quotes: ClientQuote[];
  payments: ClientPayment[];
  meetings: MeetingItem[];
  meetingDurations: number[];
  feedback: { rating: number; comment: string | null } | null;
  /** The work plan's stages the client may see. */
  milestones?: { id: string; title: string; dueDate: string | null; completedAt: Date | string | null }[];
};

const TABS = ["overview", "messages", "documents", "meetings", "quote"] as const;
type Tab = (typeof TABS)[number];

export function ClientCaseView({ c, userId, initialTab, submitted, payment, maxMb, replyHours }: { c: ClientCaseData; userId: string; initialTab?: string; submitted: boolean; payment?: string; maxMb: number; /** The office's first-response target, shown as the usual reply time. */ replyHours?: number }) {
  const { d, locale } = useI18n();
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
          {c.customerName && <p className="bidi-auto mb-1 text-base font-semibold text-slate-700">{fmt(d.caseView.greeting, { name: c.customerName.split(/\s+/)[0]! })}</p>}
          <p className="text-sm text-slate-500" dir="auto">
            {fmt(d.caseView.caseNumber, { number: c.number })} · {formatDate(c.createdAt, locale)}
            {c.openedFor && <> · {fmt(d.company.openedFor, { name: c.openedFor })}</>}
          </p>
          <h1 className="bidi-auto mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{c.title}</h1>
          <p className="mt-2 text-base font-medium text-brand-800">{d.status.clientHeadline[clientStatus]}</p>
        </div>
        <CaseStatusBadge status={c.status} audience="client" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {/* One thing first: the next step, with a button that does it (see NextStep). */}
          <NextStep
            caseId={c.id}
            actions={c.actions}
            maxMb={maxMb}
            onGo={(t) => go(t as Tab)}
            done={
              c.status === "completed" || c.status === "closed"
                ? { title: d.caseView.processComplete }
                : { title: d.caseView.nothingNeeded, text: d.caseView.nothingNeededText }
            }
          />

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

          {/* The work plan's stages, when the team set one */}
          {c.milestones && c.milestones.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{d.workPlan.clientTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {c.milestones.map((m, i) => {
                    const firstOpen = c.milestones!.findIndex((x) => !x.completedAt);
                    const state = m.completedAt ? "done" : i === firstOpen ? "current" : "upcoming";
                    return (
                      <li key={m.id} className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${state === "done" ? "bg-emerald-600 text-white" : state === "current" ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"}`}
                          aria-hidden
                        >
                          {state === "done" ? "✓" : i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className={`bidi-auto font-medium ${state === "upcoming" ? "text-slate-600" : "text-slate-900"}`}>{m.title}</p>
                          <p className="text-xs text-slate-500">
                            {d.workPlan[state]}
                            {m.dueDate && !m.completedAt && <> · {fmt(d.workPlan.target, { date: formatDate(m.dueDate, locale) })}</>}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
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
                {(c.status === "completed" || c.status === "closed") && <FeedbackCard caseId={c.id} existing={c.feedback} />}
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
                <DocumentsPanel caseId={c.id} docs={c.documents} mode="client" canEdit={false} maxMb={maxMb} signerName={c.checkout?.payerName ?? ""} canSign={c.canSign !== false} />
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
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{c.assignee.name}</p>
                    {replyHours ? (
                      <p className="flex items-center gap-1 text-xs text-slate-600">
                        <Clock className="size-3.5" aria-hidden /> {fmt(d.caseView.replyTime, { n: replyHours })}
                      </p>
                    ) : null}
                  </div>
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
