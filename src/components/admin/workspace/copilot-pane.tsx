"use client";

import { RelativeTime } from "@/components/ui/relative-time";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, ChevronDown, FileText, Info, ListChecks, MessageCircleQuestion, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Textarea } from "@/components/ui/form";
import { Notice, Spinner } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { CaseAiSummary } from "@/lib/db/schema";
import type { WorkspaceData } from "./types";

type TaskDraft = { title: string; description: string; requiresClientAction: boolean; dueDate: string | null; priority: "low" | "normal" | "high" };
type TextTool = "clarify_questions" | "professional" | "shorten" | "translate" | "summarize_thread" | "status_update";

export function CopilotPane({
  c,
  aiMock,
  onDraft,
  onOpenTab,
}: {
  c: WorkspaceData;
  aiMock: boolean;
  onDraft: (draft: { text: string; runId: string }) => void;
  onOpenTab: (tab: string, highlightId?: string) => void;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<{ text: string; runId: string } | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ runId: string; tasks: (TaskDraft & { selected: boolean })[] } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [rewriteInput, setRewriteInput] = useState("");
  const summary = c.aiSummary;
  const canAi = c.access.internal && c.customer?.aiConsent !== false;

  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(`${d.copilot.failed} (${errorText(e, d)})`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run("summary", async () => {
      await api<CaseAiSummary>("/api/ai/case-summary", { body: { caseId: c.id } });
      router.refresh();
    });

  const textTool = (tool: TextTool, input = "", targetLang?: "he" | "en") =>
    run(tool, async () => {
      const r = await api<{ text: string; runId: string }>("/api/ai/text", { body: { caseId: c.id, tool, input, targetLang } });
      setText(r);
    });

  const suggestTasks = () =>
    run("tasks", async () => {
      const r = await api<{ runId: string; tasks: TaskDraft[] }>("/api/ai/suggest-tasks", { body: { caseId: c.id } });
      setTaskDraft({ runId: r.runId, tasks: r.tasks.map((t) => ({ ...t, selected: true })) });
    });

  const createTasks = () =>
    run("createTasks", async () => {
      if (!taskDraft) return;
      await api(`/api/cases/${c.id}/tasks`, {
        body: { aiRunId: taskDraft.runId, tasks: taskDraft.tasks.filter((t) => t.selected).map(({ selected: _s, ...t }) => t) },
      });
      setTaskDraft(null);
      toast("success", d.tasks.created);
      onOpenTab("tasks");
      router.refresh();
    });

  const prepareQuote = () =>
    run("quote", async () => {
      const q = await api<{ id: string }>(`/api/cases/${c.id}/quotes`, { body: {} });
      router.push(`/admin/quotes/${q.id}?ai=1`);
    });

  const otherLang = locale === "he" ? "en" : "he";

  const sourceLabel = (s: CaseAiSummary["known_facts"][number]["sources"][number]) =>
    s.kind === "intake" ? d.copilot.sourceIntake : s.kind === "message" ? d.copilot.sourceMessage : d.copilot.sourceDocument;

  if (!canAi) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <Bot className="size-4 text-brand-700" /> {d.copilot.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Notice tone="warning">{c.access.internal ? d.copilot.noConsent : d.workspace.financeView}</Notice>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-brand-200">
        <CardHeader className="bg-gradient-to-b from-brand-50/80 to-white">
          <div>
            <CardTitle as="h2" className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-700" aria-hidden /> {d.copilot.title}
            </CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">{d.copilot.subtitle}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {aiMock && <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">{d.copilot.mockNotice}</p>}

          {/* Smart summary */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">{d.copilot.summaryTitle}</h3>
              <Button size="sm" variant="ghost" onClick={generate} loading={busy === "summary"}>
                <RefreshCw className="size-3.5" aria-hidden /> {summary ? d.copilot.regenerate : d.copilot.generate}
              </Button>
            </div>
            {busy === "summary" && <Spinner label={d.copilot.generating} />}
            {!summary && busy !== "summary" && <p className="text-sm text-slate-500">{d.copilot.noSummary}</p>}
            {summary && busy !== "summary" && (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">{d.copilot.whatWants}</dt>
                  <dd className="bidi-auto mt-0.5 text-slate-800">{summary.what_client_wants}</dd>
                </div>
                {summary.known_facts.length > 0 && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">{d.copilot.known}</dt>
                    <dd>
                      <ul className="mt-1 space-y-1">
                        {summary.known_facts.map((f, i) => (
                          <li key={i} className="bidi-auto text-slate-700">
                            • {f.fact}{" "}
                            {f.sources.map((s, j) => (
                              <button
                                key={j}
                                type="button"
                                className="ms-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-brand-100 hover:text-brand-800"
                                onClick={() => onOpenTab(s.kind === "document" ? "documents" : s.kind === "message" ? "messages" : "details", s.id ?? undefined)}
                                title={d.copilot.source}
                              >
                                {sourceLabel(s)}
                              </button>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {summary.missing_information.length > 0 && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">{d.copilot.missing}</dt>
                    <dd>
                      <ul className="mt-1 space-y-0.5 text-amber-800">
                        {summary.missing_information.map((m, i) => (
                          <li key={i} className="bidi-auto">• {m}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {summary.complexities.length > 0 && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">{d.copilot.complex}</dt>
                    <dd>
                      <ul className="mt-1 space-y-0.5 text-slate-700">
                        {summary.complexities.map((m, i) => (
                          <li key={i} className="bidi-auto">• {m}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                <div className="rounded-lg bg-brand-50 px-3 py-2">
                  <dt className="text-xs font-semibold text-brand-800">{d.copilot.next}</dt>
                  <dd className="bidi-auto mt-0.5 font-medium text-brand-900">{summary.recommended_next_step}</dd>
                </div>
              </dl>
            )}
            {summary && busy !== "summary" && (
              // Outside the list: a <dl> may hold only terms and their descriptions.
              <p className="mt-3 text-[11px] text-slate-500">
                <Badge tone="brand" className="me-1">{d.common.aiSuggestion}</Badge>
                <RelativeTime value={summary.generated_at} />
              </p>
            )}
          </section>

          {/* At most three recommended actions */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">{d.copilot.recommendedTitle}</h3>
            {c.recommendations.length === 0 ? (
              <p className="text-sm text-slate-500">{d.copilot.recNone}</p>
            ) : (
              <ul className="space-y-2">
                {c.recommendations.map((r) => {
                  const cfg =
                    r === "ask_client"
                      ? { icon: MessageCircleQuestion, title: d.copilot.recMissing, text: d.copilot.recMissingText, action: () => textTool("clarify_questions"), key: "clarify_questions", cta: d.copilot.toolClarify }
                      : r === "prepare_quote"
                        ? { icon: FileText, title: d.copilot.recQuote, text: d.copilot.recQuoteText, action: prepareQuote, key: "quote", cta: d.copilot.toolQuote }
                        : { icon: ListChecks, title: d.copilot.recTasks, text: d.copilot.recTasksText, action: suggestTasks, key: "tasks", cta: d.copilot.toolTasks };
                  return (
                    <li key={r} className="rounded-lg border border-slate-200 p-3">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <cfg.icon className="size-4 text-brand-700" aria-hidden /> {cfg.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">{cfg.text}</p>
                      <Button size="sm" variant="secondary" className="mt-2" onClick={cfg.action} loading={busy === cfg.key} disabled={!c.access.edit}>
                        <Wand2 className="size-3.5" aria-hidden /> {cfg.cta}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Drafts — never sent automatically */}
          {text && (
            <section className="rounded-lg border border-brand-200 bg-white p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand-800">
                <Info className="size-3.5" aria-hidden /> {d.copilot.draftTitle}
              </p>
              <Textarea value={text.text} onChange={(e) => setText({ ...text, text: e.target.value })} rows={8} className="bidi-auto text-sm" />
              <div className="mt-2 flex flex-wrap gap-2">
                {c.access.messages && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onDraft(text);
                      setText(null);
                    }}
                  >
                    {d.copilot.useInMessage}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setText(null)}>
                  {d.copilot.discard}
                </Button>
              </div>
            </section>
          )}

          {taskDraft && (
            <section className="rounded-lg border border-brand-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-brand-800">{d.copilot.tasksDraftTitle}</p>
              <ul className="space-y-1.5">
                {taskDraft.tasks.map((t, i) => (
                  <li key={i}>
                    <Checkbox
                      checked={t.selected}
                      onChange={(e) => setTaskDraft({ ...taskDraft, tasks: taskDraft.tasks.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)) })}
                      label={
                        <span className="bidi-auto">
                          {t.title}
                          {t.requiresClientAction && <Badge tone="warning" className="ms-1.5">{d.tasks.requiresClient}</Badge>}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={createTasks} loading={busy === "createTasks"} disabled={!taskDraft.tasks.some((t) => t.selected)}>
                  {d.copilot.createSelected}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTaskDraft(null)}>
                  {d.copilot.discard}
                </Button>
              </div>
            </section>
          )}

          {error && <Notice tone="danger">{error}</Notice>}

          {/* Everything else is available on demand */}
          <section>
            <button type="button" onClick={() => setToolsOpen((o) => !o)} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800" aria-expanded={toolsOpen}>
              {d.copilot.toolsTitle}
              <ChevronDown className={`size-4 transition ${toolsOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {toolsOpen && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => textTool("clarify_questions")} loading={busy === "clarify_questions"}>
                    {d.copilot.toolClarify}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => textTool("summarize_thread")} loading={busy === "summarize_thread"}>
                    {d.copilot.toolSummarize}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => textTool("status_update")} loading={busy === "status_update"}>
                    {d.copilot.toolStatus}
                  </Button>
                  {c.access.edit && (
                    <Button size="sm" variant="outline" onClick={suggestTasks} loading={busy === "tasks"}>
                      {d.copilot.toolTasks}
                    </Button>
                  )}
                  {c.access.manageQuotes && (
                    <Button size="sm" variant="outline" onClick={prepareQuote} loading={busy === "quote"}>
                      {d.copilot.toolQuote}
                    </Button>
                  )}
                </div>
                <div>
                  <label htmlFor="rewrite" className="mb-1 block text-xs font-medium text-slate-600">
                    {d.copilot.inputForRewrite}
                  </label>
                  <Textarea id="rewrite" value={rewriteInput} onChange={(e) => setRewriteInput(e.target.value)} rows={3} className="bidi-auto text-sm" />
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" disabled={!rewriteInput.trim()} onClick={() => textTool("professional", rewriteInput)} loading={busy === "professional"}>
                      {d.copilot.toolProfessional}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!rewriteInput.trim()} onClick={() => textTool("shorten", rewriteInput)} loading={busy === "shorten"}>
                      {d.copilot.toolShorten}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!rewriteInput.trim()} onClick={() => textTool("translate", rewriteInput, otherLang)} loading={busy === "translate"}>
                      {fmt(d.copilot.toolTranslate, { lang: d.lang[otherLang] })}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
          <p className="text-[11px] text-slate-500">{d.copilot.disclaimer}</p>
        </CardContent>
      </Card>
    </div>
  );
}
