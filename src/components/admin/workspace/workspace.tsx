"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, FilePlus2, Megaphone } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Card, CardContent } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Notice, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { TabList, TabPanel } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { CaseStatusBadge, QuoteStatusBadge, UrgencyBadge } from "@/components/app/status";
import { Timeline } from "@/components/app/timeline";
import { MessageThread } from "@/components/case/message-thread";
import { DocumentsPanel } from "@/components/case/documents-panel";
import { DetailsPane } from "./details-pane";
import { TasksPanel } from "./tasks-panel";
import { CopilotPane } from "./copilot-pane";
import type { StaffOption, TemplateOption, WorkspaceData } from "./types";
import { cn } from "@/lib/utils";

type WorkTab = "messages" | "notes" | "tasks" | "quotes" | "documents" | "timeline";
type Pane = "details" | "work" | "copilot";

export function CaseWorkspace({
  c,
  staff,
  templates,
  currentUserId,
  aiMock,
  initialTab,
  maxMb,
}: {
  c: WorkspaceData;
  staff: StaffOption[];
  templates: TemplateOption[];
  currentUserId: string;
  aiMock: boolean;
  initialTab?: string;
  maxMb: number;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const a = c.access;
  const available: WorkTab[] = [
    ...(a.messages ? (["messages", "notes"] as WorkTab[]) : []),
    ...(a.edit ? (["tasks"] as WorkTab[]) : []),
    ...(a.viewQuotes ? (["quotes"] as WorkTab[]) : []),
    ...(a.documents ? (["documents"] as WorkTab[]) : []),
    "timeline",
  ];
  const [tab, setTab] = useState<WorkTab>(available.includes(initialTab as WorkTab) ? (initialTab as WorkTab) : available[0]!);
  const [pane, setPane] = useState<Pane>("work");
  const [draft, setDraft] = useState<{ text: string; runId: string } | null>(null);
  const [update, setUpdate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const go = useCallback((t: string) => {
    if (t === "details") {
      setPane("details");
      return;
    }
    if (!available.includes(t as WorkTab)) return;
    setTab(t as WorkTab);
    setPane("work");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.join(",")]);

  const onDraft = useCallback(
    (dr: { text: string; runId: string }) => {
      setDraft(dr);
      go("messages");
    },
    [go],
  );
  const consumeDraft = useCallback(() => setDraft(null), []);

  const publishUpdate = async () => {
    setBusy("update");
    try {
      await api(`/api/cases/${c.id}/updates`, { body: { text: update } });
      setUpdate("");
      toast("success", d.common.saved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const newQuote = async () => {
    setBusy("quote");
    try {
      const q = await api<{ id: string }>(`/api/cases/${c.id}/quotes`, { body: {} });
      router.push(`/admin/quotes/${q.id}`);
    } catch (e) {
      toast("error", errorText(e, d));
      setBusy(null);
    }
  };

  const revise = async (quoteId: string) => {
    setBusy("revise" + quoteId);
    try {
      const q = await api<{ id: string }>(`/api/quotes/${quoteId}/revise`, { body: {} });
      router.push(`/admin/quotes/${q.id}`);
    } catch (e) {
      toast("error", errorText(e, d));
      setBusy(null);
    }
  };

  const tabLabels: Record<WorkTab, string> = {
    messages: d.workspace.tabs.messages,
    notes: d.workspace.tabs.notes,
    tasks: d.workspace.tabs.tasks,
    quotes: d.workspace.tabs.quotes,
    documents: d.workspace.tabs.documents,
    timeline: d.workspace.tabs.timeline,
  };
  const openTasks = c.tasks.filter((t) => !["done", "cancelled"].includes(t.status)).length;
  const pendingDocs = c.documents.filter((x) => x.status === "uploaded").length;

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/cases" className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3.5 flip-rtl" aria-hidden /> {d.admin.casesTitle}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="bidi-auto text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{c.title}</h1>
            <CaseStatusBadge status={c.status} />
            <UrgencyBadge urgency={c.urgency} />
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
            {c.number}
          </p>
        </div>
        {!a.edit && <Badge tone="muted">{d.workspace.readOnly}</Badge>}
      </div>

      {!a.internal && <Notice tone="info" className="mb-4">{d.workspace.financeView}</Notice>}

      {/* On small screens the three areas become switchable panes. */}
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 xl:hidden" role="tablist" aria-label={d.workspace.work}>
        {(["details", "work", "copilot"] as Pane[]).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn("rounded-md py-1.5 text-sm font-medium", pane === p ? "bg-white text-brand-800 shadow-sm" : "text-slate-600")}
          >
            {p === "details" ? d.workspace.paneDetails : p === "work" ? d.workspace.paneWork : d.workspace.paneCopilot}
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[16rem_minmax(0,1fr)_19rem] 2xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <div className={cn(pane !== "details" && "hidden", "xl:block")}>
          <DetailsPane c={c} staff={staff} currentUserId={currentUserId} />
        </div>

        <div className={cn("min-w-0 space-y-5", pane !== "work" && "hidden", "xl:block")}>
          <Card>
            <CardContent className="pt-2">
              <TabList
                label={d.workspace.work}
                value={tab}
                onChange={(t) => go(t)}
                tabs={available.map((t) => ({
                  id: t,
                  label: tabLabels[t],
                  badge:
                    t === "tasks" && openTasks ? (
                      <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{openTasks}</span>
                    ) : t === "documents" && pendingDocs ? (
                      <span className="rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800">{pendingDocs}</span>
                    ) : undefined,
                }))}
              />
              <div className="py-4">
                <TabPanel id="messages" active={tab === "messages"}>
                  <MessageThread caseId={c.id} messages={c.messages} currentUserId={currentUserId} kind="thread" canPost={a.messages} staffComposer draft={draft} onDraftConsumed={consumeDraft} />
                </TabPanel>
                <TabPanel id="notes" active={tab === "notes"}>
                  <MessageThread caseId={c.id} messages={c.messages} currentUserId={currentUserId} kind="internal_note" canPost={a.internal} staffComposer />
                </TabPanel>
                <TabPanel id="tasks" active={tab === "tasks"}>
                  <TasksPanel caseId={c.id} tasks={c.tasks} staff={staff} templates={templates} canEdit={a.edit} />
                </TabPanel>
                <TabPanel id="quotes" active={tab === "quotes"} className="space-y-4">
                  {a.manageQuotes && !c.quotes.some((q) => q.status === "draft") && !["active", "awaiting_client", "completed", "closed", "cancelled"].includes(c.status) && (
                    <Button onClick={newQuote} loading={busy === "quote"}>
                      <FilePlus2 className="size-4" aria-hidden /> {d.workspace.newQuote}
                    </Button>
                  )}
                  {c.quotes.length === 0 ? (
                    <EmptyState title={d.workspace.noQuotes} className="py-8" />
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {c.quotes.map((q) => (
                        <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="bidi-auto text-sm font-medium text-slate-900">
                              {q.serviceName || "—"} <span className="text-xs text-slate-500">· {fmt(d.quote.version, { n: q.version })}</span>
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatMoney(q.totalCents, q.currency, locale)}
                              {q.sentAt && <> · {formatDateTime(q.sentAt, locale)}</>}
                            </p>
                          </div>
                          <QuoteStatusBadge status={q.status} expired={q.expired} />
                          <ButtonLink href={`/admin/quotes/${q.id}`} size="sm" variant="outline">
                            {q.status === "draft" && a.manageQuotes ? d.common.edit : d.common.view}
                          </ButtonLink>
                          {a.manageQuotes && ["sent", "clarification_requested", "declined", "expired"].includes(q.status) && !c.quotes.some((x) => x.status === "draft") && (
                            <Button size="sm" variant="ghost" onClick={() => revise(q.id)} loading={busy === "revise" + q.id}>
                              {d.quoteEditor.revise}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.payments.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-800">{d.quote.paymentsTitle}</h3>
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                        {c.payments.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                            <span>{formatMoney(p.amountCents, p.currency, locale)}</span>
                            <span className="text-xs text-slate-500">
                              {p.provider} · {formatDateTime(p.paidAt ?? p.createdAt, locale)}
                            </span>
                            <Badge tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{d.paymentStatus[p.status as "pending"]}</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </TabPanel>
                <TabPanel id="documents" active={tab === "documents"}>
                  <DocumentsPanel
                    caseId={c.id}
                    docs={c.documents}
                    mode="staff"
                    canEdit={a.edit}
                    maxMb={maxMb}
                    checklistTemplates={templates
                      .filter((t) => t.documents?.length)
                      .sort((x, y) => Number(y.category === c.serviceCategory) - Number(x.category === c.serviceCategory))}
                  />
                </TabPanel>
                <TabPanel id="timeline" active={tab === "timeline"}>
                  <Timeline events={c.events} audience="staff" />
                </TabPanel>
              </div>
            </CardContent>
          </Card>

          {a.edit && (
            <Card>
              <CardContent className="py-4">
                <label htmlFor="client-update" className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Megaphone className="size-4 text-brand-700" aria-hidden /> {d.workspace.clientUpdate}
                </label>
                <Textarea id="client-update" value={update} onChange={(e) => setUpdate(e.target.value)} rows={2} placeholder={d.workspace.clientUpdatePlaceholder} className="bidi-auto" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Link href={`/admin/cases/${c.id}?tab=timeline`} onClick={() => go("timeline")} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                    <ExternalLink className="size-3" aria-hidden /> {d.workspace.tabs.timeline}
                  </Link>
                  <Button size="sm" onClick={publishUpdate} loading={busy === "update"} disabled={!update.trim()}>
                    {d.workspace.publish}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className={cn(pane !== "copilot" && "hidden", "xl:block")}>
          <div className="xl:sticky xl:top-20">
            <CopilotPane c={c} aiMock={aiMock} onDraft={onDraft} onOpenTab={go} />
          </div>
        </div>
      </div>
    </div>
  );
}
