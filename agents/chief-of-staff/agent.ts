/**
 * Chief of Staff agent for Case Manager, built on the Claude Agent SDK. Adapted from Anthropic's cookbook
 * "The chief of staff agent" (claude-cookbooks/claude_agent_sdk/01_The_chief_of_staff_agent.ipynb).
 *
 * The same features, pointed at this business:
 * - Memory: CLAUDE.md in this folder (how the business and its data work, which scripts to run).
 * - Scripts via Bash: scripts/*.ts read the live Case Manager database (read-only) and do the math.
 * - Output styles: .claude/output-styles/ (executive, technical), chosen per query.
 * - Plan mode: the agent researches and writes a plan; it's saved to plans/ and nothing runs.
 * - Slash commands: .claude/commands/ (/budget-impact, /capacity-scan, /strategic-brief, /weekly-brief).
 * - Hooks: .claude/settings.json logs script runs and report writes to audit/; a PreToolUse hook in this
 *   file enforces lib/policy.ts on every tool call, subagents included.
 * - Subagents: .claude/agents/ (financial-analyst, operations-analyst) via the Agent tool.
 *
 * Use it from code (sendQuery) or the command line (cli.ts / `npm run agent` in the repo root).
 */
import "./lib/env";
import { query, type HookCallback, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { decideToolUse, isClaudePlanFile, localSubagents } from "./lib/policy";
import { AGENT_DIR } from "./lib/paths";
import { mainThreadText } from "./lib/activity";
import { extractPlan, savePlan } from "./lib/plan";

export const DEFAULT_MODEL = process.env.CHIEF_OF_STAFF_MODEL || "claude-opus-5-5";

export const SYSTEM_PROMPT = `You are the Chief of Staff for the business that runs this Case Manager installation: a service business that takes requests from clients, quotes them, gets paid and handles each case to completion. The owner comes to you with questions about money, capacity, the team, the pipeline and strategic choices, and needs answers they can act on.

How you work:
- Ground every number in data. Run the scripts described in CLAUDE.md instead of estimating, and say which script and period each number comes from. If the data can't answer the question, say so.
- Delegate specialised analysis: money (revenue, costs, runway, pricing, the cost of a hire) to the financial-analyst subagent; workload, response times, SLA, bottlenecks and whether to hire to the operations-analyst subagent. For decisions that touch both, ask both and reconcile what they find.
- The business data is read-only for you. You can't change cases, quotes, payments or settings: recommend what the owner should do in the app.
- Client privacy: the scripts return aggregates. Never ask for, guess or repeat client names, contact details or case contents.
- When the business profile (data/business-profile.json) is missing a number you need, such as cash on hand or fixed costs, say which one, and either ask for it or show the calculation with the assumption clearly marked.
- Save reports only under output_reports/. Answer in the language of the question (Hebrew or English), with money in the currency the data reports.`;

const PLAN_INSTRUCTIONS = `Research first with the read-only tools: the scripts in scripts/ and the files in this folder. Don't change anything. Then write the complete plan in your reply inside <plan></plan> tags: the goal, the steps with owners and dates, what it costs and does to runway, the risks, and how success will be measured. Finish by calling ExitPlanMode.`;

/** Built-in tools the agent can see; lib/policy.ts decides what each call may do. */
const TOOLS = ["Agent", "Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebSearch", "TodoWrite"];

export type SendQueryOptions = {
  /** Continue the most recent conversation (e.g. to carry out a plan after reviewing it). */
  continueConversation?: boolean;
  /** "default" acts within the tool policy; "plan" researches and writes a plan without changing anything. */
  permissionMode?: "default" | "plan";
  /** An output style from .claude/output-styles (e.g. "executive", "technical"). */
  outputStyle?: string;
  model?: string;
  maxTurns?: number;
  /** Stop the run once its estimated cost passes this many US dollars. */
  maxBudgetUsd?: number;
  /** Called for every message as it streams (tool calls, subagent activity, the result). */
  onMessage?: (msg: SDKMessage) => void | Promise<void>;
  /** Called when the tool policy refuses a call (the main agent's or a subagent's). */
  onRefused?: (refusal: { tool: string; input: Record<string, unknown>; reason: string; subagent: string | null }) => void;
  abortController?: AbortController;
};

export type QueryResult = {
  /** The final answer text, or null if the run ended without one. */
  result: string | null;
  messages: SDKMessage[];
  sessionId: string | null;
  costUsd: number | null;
  /** Plan mode only: where the plan was saved. */
  planFile: string | null;
};

/** Sends one query to the Chief of Staff and waits for the answer. */
export async function sendQuery(prompt: string, opts: SendQueryOptions = {}): Promise<QueryResult> {
  const mode = opts.permissionMode ?? "default";
  const model = opts.model ?? DEFAULT_MODEL;
  const planFileWrites: string[] = [];
  const policy = { mode, subagents: localSubagents() };

  // Runs before every tool call, the subagents' included, so the policy can't be sidestepped.
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const decision = decideToolUse(input.tool_name, toolInput, policy);
    if (decision.allow && mode === "plan" && input.tool_name === "Write" && isClaudePlanFile(String(toolInput.file_path ?? ""))) {
      planFileWrites.push(String(toolInput.content ?? ""));
    }
    if (!decision.allow) opts.onRefused?.({ tool: input.tool_name, input: toolInput, reason: decision.reason, subagent: input.agent_type ?? null });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.allow ? "allow" : "deny",
        permissionDecisionReason: decision.allow ? undefined : decision.reason,
      },
    };
  };

  const options: Options = {
    model,
    effort: "high",
    cwd: AGENT_DIR,
    // "project" loads CLAUDE.md and .claude/ (agents, commands, output styles, hooks) from this folder, and
    // keeps the owner's personal ~/.claude settings out of the run.
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_PROMPT },
    tools: mode === "plan" ? [...TOOLS, "ExitPlanMode"] : TOOLS,
    permissionMode: mode,
    planModeInstructions: mode === "plan" ? PLAN_INSTRUCTIONS : undefined,
    hooks: { PreToolUse: [{ hooks: [guard] }] },
    // Anything the hook didn't settle still goes through the same policy.
    canUseTool: async (toolName, input) => {
      const decision = decideToolUse(toolName, input, policy);
      return decision.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: decision.reason };
    },
    settings: opts.outputStyle ? { outputStyle: opts.outputStyle } : undefined,
    continue: opts.continueConversation,
    maxTurns: opts.maxTurns ?? 40,
    maxBudgetUsd: opts.maxBudgetUsd,
    abortController: opts.abortController,
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "case-manager-chief-of-staff/1.0.0" },
  };

  const messages: SDKMessage[] = [];
  const replyTexts: string[] = [];
  let result: string | null = null;
  let sessionId: string | null = null;
  let costUsd: number | null = null;

  for await (const msg of query({ prompt, options })) {
    messages.push(msg);
    replyTexts.push(...mainThreadText(msg));
    if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
    if (msg.type === "result") {
      costUsd = msg.total_cost_usd;
      if (msg.subtype === "success") result = msg.result;
      else result = msg.errors?.length ? `Stopped (${msg.subtype}): ${msg.errors.join("; ")}` : null;
    }
    await opts.onMessage?.(msg);
  }

  let planFile: string | null = null;
  if (mode === "plan") {
    const plan = extractPlan({ replyTexts, planFileWrites, finalResult: result });
    if (plan) planFile = savePlan(plan, { prompt, model });
  }
  return { result, messages, sessionId, costUsd, planFile };
}
