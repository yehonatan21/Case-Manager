/**
 * Which tool calls the Chief of Staff may make. agent.ts runs every call through `decideToolUse`, in a
 * PreToolUse hook (which also sees its subagents' calls) and again in canUseTool:
 * - Bash: only this folder's own scripts, as `node --import tsx scripts/<name>.ts [args]`, with no shell
 *   operators (no chaining, pipes, redirects or substitution).
 * - Read / Glob / Grep: only inside this folder, never node_modules or .env files.
 * - Write / Edit: only reports (output_reports/), plans (plans/) and the business profile.
 * - Agent: only to this folder's own subagents (.claude/agents/*.md), not Claude Code's built-in ones.
 * - WebSearch, TodoWrite: allowed. Anything else is refused.
 * In plan mode nothing is changed: the only write allowed is Claude Code's own plan file, and ExitPlanMode is
 * answered with "saved for review" so the plan is never executed in the same run.
 */
import fs from "node:fs";
import path from "node:path";
import { AGENT_DIR, WRITABLE_DIRS, isInside } from "./paths";

export type Decision = { allow: true } | { allow: false; reason: string };

const SCRIPT_COMMAND = /^node --import tsx scripts\/[a-z0-9-]+\.ts(?: [^;&|`$<>\\\r\n]*)?$/;

export function isAllowedScriptCommand(command: string): boolean {
  return SCRIPT_COMMAND.test(command.trim());
}

const ALWAYS_ALLOWED = new Set(["WebSearch", "TodoWrite"]);

/** The subagents defined in `<root>/.claude/agents/` (file name = agent name). */
export function localSubagents(root = AGENT_DIR): string[] {
  const dir = path.join(root, ".claude", "agents");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [];
}

function readable(p: string, root: string): boolean {
  const full = path.resolve(root, p);
  if (!isInside(full, root)) return false;
  const parts = path.relative(root, full).split(path.sep);
  return !parts.includes("node_modules") && !parts.some((s) => s === ".env" || s.startsWith(".env."));
}

function writable(p: string, root: string): boolean {
  const full = path.resolve(root, p);
  if (full === path.join(root, "data", "business-profile.json")) return true;
  return WRITABLE_DIRS.some((d) => isInside(full, path.join(root, d)) && full !== path.join(root, d));
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Claude Code's own plan file (~/.claude/plans/<name>.md), which plan mode asks the model to write. */
export const isClaudePlanFile = (p: string) => /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/.test(p);

export type PolicyOptions = { mode?: "default" | "plan"; root?: string; subagents?: string[] };

export function decideToolUse(toolName: string, input: Record<string, unknown>, { mode = "default", root = AGENT_DIR, subagents }: PolicyOptions = {}): Decision {
  if (ALWAYS_ALLOWED.has(toolName)) return { allow: true };
  if (toolName === "Agent" || toolName === "Task") {
    const allowed = subagents ?? localSubagents(root);
    const type = str(input.subagent_type) ?? "";
    return allowed.includes(type) ? { allow: true } : { allow: false, reason: `Delegate only to your own subagents: ${allowed.join(", ")}.` };
  }
  if (mode === "plan") {
    if (toolName === "ExitPlanMode") {
      return { allow: false, reason: "The plan was received and is saved for the owner to review. Don't execute it: end your turn with a one-line summary." };
    }
    if (toolName === "Read" && isClaudePlanFile(str(input.file_path) ?? "")) return { allow: true };
    if (toolName === "Write" || toolName === "Edit") {
      const p = str(input.file_path);
      return p && isClaudePlanFile(p) ? { allow: true } : { allow: false, reason: "Plan mode: don't change files. Put the full plan in your reply inside <plan></plan> tags." };
    }
  }
  switch (toolName) {
    case "Bash": {
      const command = str(input.command) ?? "";
      return isAllowedScriptCommand(command)
        ? { allow: true }
        : { allow: false, reason: "Only this folder's scripts may run, as `node --import tsx scripts/<name>.ts [args]` with no pipes, chaining or redirects (see CLAUDE.md)." };
    }
    case "Read": {
      const p = str(input.file_path);
      return p && readable(p, root) ? { allow: true } : { allow: false, reason: "Reading is limited to the Chief of Staff folder (no node_modules or .env files)." };
    }
    case "Glob":
    case "Grep": {
      const p = str(input.path) ?? root;
      const patterns = [str(input.pattern), str(input.glob)].filter((x): x is string => !!x);
      if (!readable(p, root) || patterns.some((x) => x.includes("..") || (toolName === "Glob" && path.isAbsolute(x)))) {
        return { allow: false, reason: "Searching is limited to the Chief of Staff folder." };
      }
      return { allow: true };
    }
    case "Write":
    case "Edit": {
      const p = str(input.file_path);
      return p && writable(p, root)
        ? { allow: true }
        : { allow: false, reason: "Write reports to output_reports/ and plans to plans/; the only other file you may change is data/business-profile.json." };
    }
    default:
      return { allow: false, reason: `The ${toolName} tool isn't available to the Chief of Staff.` };
  }
}
