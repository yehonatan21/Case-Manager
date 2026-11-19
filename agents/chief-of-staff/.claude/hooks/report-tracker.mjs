#!/usr/bin/env node
/**
 * PostToolUse hook (Write, Edit): records every file the agent creates or changes in audit/report_history.json
 * (the last 100), so there's a trail of which reports and plans were written and when.
 * Never fails the tool call: problems are reported on stderr and the hook exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const historyFile = path.join(agentDir, "audit", "report_history.json");

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

try {
  const input = readStdin();
  const filePath = input?.tool_input?.file_path;
  if (filePath) {
    const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, "utf8")) : { reports: [] };
    const content = input.tool_input.content ?? input.tool_input.new_string ?? "";
    history.reports.push({
      timestamp: new Date().toISOString(),
      file: path.relative(agentDir, filePath) || filePath,
      action: input.tool_name === "Write" ? "written" : "edited",
      words: content ? content.split(/\s+/).filter(Boolean).length : 0,
      tool: input.tool_name,
      subagent: input.agent_type ?? null,
      session_id: input.session_id ?? null,
    });
    history.reports = history.reports.slice(-100);
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  }
} catch (err) {
  console.error(`report-tracker: ${err instanceof Error ? err.message : err}`);
}
process.exit(0);
