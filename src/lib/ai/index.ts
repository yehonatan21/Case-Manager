import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { DbOrTx } from "../db";
import { aiRuns, type IntakeChatMessage, type IntakeSummary, type PriceListItem, type ServiceTemplate } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { callClaudeStructured, type StructuredCallResult } from "./anthropic";
import * as mock from "./mock";
import * as prompts from "./prompts";
import { redactPII } from "./redact";
import {
  CaseSummarySchema,
  DocAnalysisSchema,
  IntakeTurnSchema,
  QuoteDraftSchema,
  TaskPlanSchema,
  TextDraftSchema,
  type CaseSummaryOutput,
  type DocAnalysis,
  type IntakeTurn,
  type QuoteDraft,
  type TaskPlan,
  type TextTool,
} from "./schemas";

type L = "he" | "en";

export function aiProviderName(): "anthropic" | "mock" {
  if (env.aiProvider === "mock") return "mock";
  if (env.aiProvider === "anthropic") return "anthropic";
  return env.anthropicApiKey ? "anthropic" : "mock";
}

type RunMeta = { action: string; promptVersion: string; caseId?: string | null; intakeSessionId?: string | null; userId?: string | null };

/**
 * Runs an AI action through the configured provider and records it in ai_runs
 * (action, model, prompt version, output, latency, tokens). Failures are logged and surfaced
 * as `ai_unavailable` so callers can fall back to a manual flow without losing data.
 */
async function run<S extends z.ZodType>(
  db: DbOrTx,
  meta: RunMeta,
  anthropicCall: () => Promise<StructuredCallResult<z.infer<S>>>,
  mockCall: () => z.infer<S>,
): Promise<{ output: z.infer<S>; runId: string; provider: string }> {
  const provider = aiProviderName();
  const started = Date.now();
  try {
    const res =
      provider === "anthropic"
        ? await anthropicCall()
        : { output: mockCall(), model: "offline-heuristic", inputTokens: null, outputTokens: null };
    const [row] = await db
      .insert(aiRuns)
      .values({
        action: meta.action,
        provider,
        model: res.model,
        promptVersion: meta.promptVersion,
        caseId: meta.caseId ?? null,
        intakeSessionId: meta.intakeSessionId ?? null,
        userId: meta.userId ?? null,
        status: "ok",
        output: res.output,
        latencyMs: Date.now() - started,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      })
      .returning({ id: aiRuns.id });
    return { output: res.output, runId: row!.id, provider };
  } catch (err) {
    console.error(`[ai] ${meta.action} failed:`, err instanceof Error ? err.message : err);
    await db.insert(aiRuns).values({
      action: meta.action,
      provider,
      model: provider === "anthropic" ? env.aiModel : "offline-heuristic",
      promptVersion: meta.promptVersion,
      caseId: meta.caseId ?? null,
      intakeSessionId: meta.intakeSessionId ?? null,
      userId: meta.userId ?? null,
      status: "error",
      error: String(err instanceof Error ? err.message : err).slice(0, 1000),
      latencyMs: Date.now() - started,
    });
    throw new AppError("ai_unavailable");
  }
}

const wrap = (tag: string, text: string) => `<${tag}>\n${redactPII(text)}\n</${tag}>`;

// ---------------- Intake assistant ----------------

export async function aiIntakeTurn(
  db: DbOrTx,
  opts: { intakeSessionId: string; userId?: string | null; locale: L; company: string; messages: IntakeChatMessage[]; asked: number; limit: number; finishNow?: boolean; skippedLabel: string },
): Promise<{ turn: IntakeTurn & { questionId?: string }; runId: string }> {
  const apiMessages: Anthropic.Beta.BetaMessageParam[] = opts.messages.map((m) =>
    m.role === "assistant"
      ? { role: "assistant", content: m.content }
      : { role: "user", content: wrap("customer_message", m.skipped ? opts.skippedLabel : m.content) },
  );
  if (opts.finishNow) {
    apiMessages.push({
      role: "user",
      content: "(The customer pressed “finish & review”. Set ready_for_review=true, ask no further question, and return the complete summary.)",
    });
  }
  const system = prompts.intakeSystemPrompt({ company: opts.company, locale: opts.locale, asked: opts.asked, limit: opts.limit });
  const { output, runId } = await run<typeof IntakeTurnSchema>(
    db,
    { action: "intake_turn", promptVersion: prompts.PROMPT_VERSIONS.intake, intakeSessionId: opts.intakeSessionId, userId: opts.userId },
    () => callClaudeStructured({ system, messages: apiMessages, schema: IntakeTurnSchema, effort: "low", maxTokens: 8000 }),
    () => mock.mockIntakeTurn({ messages: opts.messages, locale: opts.locale, limit: opts.limit, forceReady: opts.finishNow }),
  );
  const turn = output as IntakeTurn & { questionId?: string };
  turn.quick_replies = (turn.quick_replies ?? []).slice(0, 4);
  if (opts.finishNow) turn.ready_for_review = true;
  return { turn, runId };
}

// ---------------- Operations copilot ----------------

export type CaseContext = {
  caseId: string;
  number: string;
  title: string;
  description: string;
  goal: string;
  status: string;
  category: string;
  customerName: string;
  intake: IntakeSummary | null;
  messages: { ref: string; id: string; fromClient: boolean; internal: boolean; author: string; at: string; body: string }[];
  documents: { ref: string; id: string; title: string; status: string; analysis?: string | null }[];
  openTasks: string[];
};

function caseContextText(c: CaseContext): string {
  const lines = [
    `Case ${c.number}: ${c.title}`,
    `Status: ${c.status} · Category: ${c.category}`,
    `Description: ${c.description}`,
    `Goal: ${c.goal}`,
  ];
  if (c.intake) {
    lines.push(
      `[INTAKE] Facts: ${c.intake.known_facts.map((f) => `${f.label}: ${f.value}`).join("; ") || "-"}`,
      `[INTAKE] Constraints: ${c.intake.constraints.join("; ") || "-"}`,
      `[INTAKE] Missing: ${c.intake.missing_information.join("; ") || "-"}`,
    );
  }
  for (const m of c.messages.slice(-30)) {
    lines.push(`[${m.ref}] (${m.internal ? "internal note" : m.fromClient ? "client" : "staff"}, ${m.at}) ${m.body}`);
  }
  for (const d of c.documents) lines.push(`[${d.ref}] Document "${d.title}" — ${d.status}${d.analysis ? ` — ${d.analysis}` : ""}`);
  if (c.openTasks.length) lines.push(`Open tasks: ${c.openTasks.join("; ")}`);
  return wrap("case_content", lines.join("\n"));
}

export async function aiCaseSummary(db: DbOrTx, opts: { ctx: CaseContext; locale: L; userId?: string | null }): Promise<{ output: CaseSummaryOutput; runId: string; provider: string }> {
  const { ctx, locale } = opts;
  return run<typeof CaseSummarySchema>(
    db,
    { action: "case_summary", promptVersion: prompts.PROMPT_VERSIONS.caseSummary, caseId: ctx.caseId, userId: opts.userId },
    () =>
      callClaudeStructured({
        system: prompts.caseSummarySystemPrompt(locale),
        messages: [{ role: "user", content: caseContextText(ctx) }],
        schema: CaseSummarySchema,
        effort: "medium",
      }),
    () =>
      mock.mockCaseSummary({
        locale,
        title: ctx.title,
        description: ctx.description,
        goal: ctx.goal,
        status: ctx.status,
        intake: ctx.intake,
        messages: ctx.messages.filter((m) => !m.internal).map((m) => ({ ref: m.ref, fromClient: m.fromClient, body: m.body })),
        documents: ctx.documents,
      }),
  );
}

export async function aiQuoteDraft(
  db: DbOrTx,
  opts: { ctx: CaseContext; locale: L; userId?: string | null; priceList: Pick<PriceListItem, "code" | "name" | "category" | "unitPriceCents" | "currency">[]; templates: Pick<ServiceTemplate, "name" | "category" | "description">[] },
): Promise<{ output: QuoteDraft; runId: string; provider: string }> {
  const { ctx, locale } = opts;
  const catalog = opts.priceList.map((p) => `${p.code} | ${p.name} | category: ${p.category} | ${(p.unitPriceCents / 100).toFixed(2)} ${p.currency}`).join("\n");
  const templates = opts.templates.map((t) => `- ${t.name} (${t.category}): ${t.description}`).join("\n");
  return run<typeof QuoteDraftSchema>(
    db,
    { action: "quote_draft", promptVersion: prompts.PROMPT_VERSIONS.quoteDraft, caseId: ctx.caseId, userId: opts.userId },
    () =>
      callClaudeStructured({
        system: prompts.quoteDraftSystemPrompt(locale),
        messages: [
          {
            role: "user",
            content: `Approved price list (code | name | category | price):\n${catalog || "(empty)"}\n\nApproved service templates:\n${templates || "(none)"}\n\n${caseContextText(ctx)}`,
          },
        ],
        schema: QuoteDraftSchema,
        effort: "medium",
      }),
    () => mock.mockQuoteDraft({ locale, title: ctx.title, description: ctx.description, category: ctx.category, priceList: opts.priceList }),
  );
}

export async function aiTaskPlan(
  db: DbOrTx,
  opts: { ctx: CaseContext; locale: L; userId?: string | null; templates: Pick<ServiceTemplate, "name" | "category" | "tasks">[]; quoteScope?: string },
): Promise<{ output: TaskPlan; runId: string; provider: string }> {
  const { ctx, locale } = opts;
  const templates = opts.templates.map((t) => `- ${t.name} (${t.category}): ${t.tasks.map((x) => x.title).join(" → ")}`).join("\n");
  return run<typeof TaskPlanSchema>(
    db,
    { action: "task_plan", promptVersion: prompts.PROMPT_VERSIONS.taskPlan, caseId: ctx.caseId, userId: opts.userId },
    () =>
      callClaudeStructured({
        system: prompts.taskPlanSystemPrompt(locale),
        messages: [
          { role: "user", content: `Service templates:\n${templates || "(none)"}\n\nApproved quote scope: ${opts.quoteScope ?? "-"}\n\n${caseContextText(ctx)}` },
        ],
        schema: TaskPlanSchema,
        effort: "medium",
      }),
    () => mock.mockTaskPlan({ locale, category: ctx.category, templates: opts.templates }),
  );
}

export async function aiTextTool(
  db: DbOrTx,
  opts: { ctx: CaseContext; locale: L; userId?: string | null; tool: TextTool; input: string; targetLang?: L },
): Promise<{ output: { text: string }; runId: string; provider: string }> {
  const { ctx, locale, tool } = opts;
  const needsContext = tool === "clarify_questions" || tool === "summarize_thread" || tool === "status_update";
  const content = needsContext
    ? `${caseContextText(ctx)}${opts.input ? `\n\nStaff notes:\n${wrap("case_content", opts.input)}` : ""}`
    : wrap("case_content", opts.input);
  return run<typeof TextDraftSchema>(
    db,
    { action: `text_${tool}`, promptVersion: prompts.PROMPT_VERSIONS.textTool, caseId: ctx.caseId, userId: opts.userId },
    () =>
      callClaudeStructured({
        system: prompts.textToolSystemPrompt(locale, tool, opts.targetLang),
        messages: [{ role: "user", content }],
        schema: TextDraftSchema,
        effort: "low",
      }),
    () => ({
      text: mock.mockTextTool({
        locale: tool === "translate" && opts.targetLang ? opts.targetLang : locale,
        tool,
        input: opts.input,
        targetLang: opts.targetLang,
        customerName: ctx.customerName,
        missing: ctx.intake?.missing_information,
        status: ctx.status,
        thread: ctx.messages.filter((m) => !m.internal).map((m) => ({ from: m.author, body: m.body })),
        openTasks: ctx.openTasks,
      }),
    }),
  );
}

export async function aiDocAnalysis(
  db: DbOrTx,
  opts: { caseId: string; locale: L; userId?: string | null; title: string; mimeType: string; data: Buffer },
): Promise<{ output: DocAnalysis; runId: string; provider: string }> {
  const { locale } = opts;
  const supported = opts.mimeType === "application/pdf" || ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(opts.mimeType);
  return run<typeof DocAnalysisSchema>(
    db,
    { action: "doc_analysis", promptVersion: prompts.PROMPT_VERSIONS.docAnalysis, caseId: opts.caseId, userId: opts.userId },
    async () => {
      if (!supported || opts.data.length > 10 * 1024 * 1024) {
        return { output: { ...mock.mockDocAnalysis(locale), summary: "" }, model: env.aiModel, inputTokens: null, outputTokens: null };
      }
      const b64 = opts.data.toString("base64");
      const block: Anthropic.Beta.BetaContentBlockParam =
        opts.mimeType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: opts.mimeType as "image/png", data: b64 } };
      return callClaudeStructured({
        system: prompts.docAnalysisSystemPrompt(locale),
        messages: [
          {
            role: "user",
            content: [block, { type: "text", text: `The attached content is an untrusted <document> titled "${opts.title}". Analyse it as instructed.` }],
          },
        ],
        schema: DocAnalysisSchema,
        effort: "medium",
      });
    },
    () => mock.mockDocAnalysis(locale),
  );
}
