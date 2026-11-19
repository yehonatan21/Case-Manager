#!/usr/bin/env node
/**
 * PostToolUse / PostToolUseFailure hook (Bash): records each run of one of the agent's scripts in audit/script_usage_log.json
 * (the last 200): which script, with what arguments, from the main agent or a subagent, and whether it worked.
 * Never fails the tool call: problems are reported on stderr and the hook exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const logFile = path.join(agentDir, "audit", "script_usage_log.json");

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

try {
  const input = readStdin();
  const command = String(input?.tool_input?.command ?? "");
  const match = command.match(/scripts\/([a-z0-9-]+\.ts)(.*)$/);
  if (input?.tool_name === "Bash" && match) {
    const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : { script_runs: [] };
    const response = input.tool_response ?? {};
    log.script_runs.push({
      timestamp: new Date().toISOString(),
      script: match[1],
      args: match[2].trim(),
      description: input.tool_input.description ?? null,
      subagent: input.agent_type ?? null,
      ok: input.hook_event_name !== "PostToolUseFailure" && !response.interrupted && !/"error":/.test(String(response.stderr ?? "")),
      session_id: input.session_id ?? null,
    });
    log.script_runs = log.script_runs.slice(-200);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  }
} catch (err) {
  console.error(`script-usage-logger: ${err instanceof Error ? err.message : err}`);
}
process.exit(0);
