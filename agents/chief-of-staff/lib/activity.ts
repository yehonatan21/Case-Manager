/**
 * One line per step of a run, for the terminal (the cookbook's print_activity): tool calls, delegation to
 * subagents (🚀) and the tools they use (indented 📎), denied calls, and the final cost.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describeToolUse(name: string, input: Record<string, unknown>): string {
  if (name === "Agent" || name === "Task") return `🚀 Delegating to ${String(input.subagent_type ?? "subagent")}: ${clip(String(input.description ?? ""), 80)}`;
  if (name === "Bash") return `🤖 Bash: ${clip(String(input.command ?? ""))}`;
  const target = input.file_path ?? input.path ?? input.pattern ?? input.query;
  return `🤖 ${name}${target ? `: ${clip(String(target))}` : ""}`;
}

export function describeMessage(msg: SDKMessage): string[] {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        return [`⚙️  ${msg.model} · output style: ${msg.output_style} · subagents: ${(msg.agents ?? []).join(", ") || "none"}`];
      }
      return [];
    case "assistant": {
      const nested = msg.parent_tool_use_id !== null;
      const lines: string[] = [];
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          const line = describeToolUse(block.name, (block.input ?? {}) as Record<string, unknown>);
          lines.push(nested ? `    📎 ${line.replace(/^🤖 /, "")}` : line);
        }
      }
      return lines;
    }
    case "result": {
      const cost = typeof msg.total_cost_usd === "number" ? ` · ~$${msg.total_cost_usd.toFixed(2)}` : "";
      const denied = msg.permission_denials?.length ? ` · ${msg.permission_denials.length} tool call(s) refused` : "";
      return [`✅ ${msg.subtype === "success" ? "Done" : `Stopped (${msg.subtype})`} in ${Math.round(msg.duration_ms / 1000)}s, ${msg.num_turns} turns${cost}${denied}`];
    }
    default:
      return [];
  }
}

/** Text the assistant wrote in the main conversation (not inside subagents). */
export function mainThreadText(msg: SDKMessage): string[] {
  if (msg.type !== "assistant" || msg.parent_tool_use_id !== null) return [];
  return msg.message.content.flatMap((b) => (b.type === "text" ? [b.text] : []));
}
