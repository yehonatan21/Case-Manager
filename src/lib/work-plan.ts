import type { ServiceTemplateStage, ServiceTemplateTask } from "./db/schema";

/**
 * A service template's work plan as plain text, one line each:
 *   ## Collect documents | 7          a stage, with its target in days from the start (optional)
 *   ## Internal review (team)          "(team)" / "(צוות)": a stage the client doesn't see
 *   * Upload a passport copy | 3       a task; "*" = the client does it
 *   > Prepare the application | 10     ">" = waits for the task above it
 * Tasks before the first stage belong to no stage.
 */
const TEAM = /\s*\((team|צוות)\)\s*$/i;
const num = (s: string | undefined) => (s && /^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : undefined);

export function parseWorkPlan(text: string): { stages: ServiceTemplateStage[]; tasks: ServiceTemplateTask[] } {
  const stages: ServiceTemplateStage[] = [];
  const tasks: ServiceTemplateTask[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const [title = "", days] = line.replace(/^#+\s*/, "").split("|").map((p) => p.trim());
      const clean = title.replace(TEAM, "").trim();
      if (!clean) continue;
      stages.push({ title: clean, ...(num(days) != null ? { dueInDays: num(days) } : {}), ...(TEAM.test(title) ? { clientVisible: false } : {}) });
      continue;
    }
    let rest = line;
    let after = false;
    let client = false;
    // ">" and "*" in any order at the start; "*" at the end also marks a client action.
    for (;;) {
      if (rest.startsWith(">")) after = true;
      else if (rest.startsWith("*")) client = true;
      else break;
      rest = rest.slice(1).trimStart();
    }
    if (rest.endsWith("*")) {
      client = true;
      rest = rest.slice(0, -1).trimEnd();
    }
    const [title = "", days] = rest.split("|").map((p) => p.trim());
    if (!title) continue;
    const prev = tasks.length - 1;
    tasks.push({
      title,
      requiresClientAction: client,
      ...(num(days) != null ? { dueInDays: num(days) } : {}),
      ...(stages.length ? { stage: stages.length - 1 } : {}),
      ...(after && prev >= 0 ? { after: prev } : {}),
    });
  }
  return { stages, tasks };
}

export function formatWorkPlan(stages: ServiceTemplateStage[], tasks: ServiceTemplateTask[], teamWord = "team"): string {
  const taskLine = (t: ServiceTemplateTask, i: number) =>
    `${t.after != null && t.after === i - 1 ? "> " : ""}${t.requiresClientAction ? "* " : ""}${t.title}${t.dueInDays != null ? ` | ${t.dueInDays}` : ""}`;
  const lines: string[] = [];
  tasks.forEach((t, i) => t.stage == null && lines.push(taskLine(t, i)));
  stages.forEach((s, si) => {
    lines.push(`## ${s.title}${s.clientVisible === false ? ` (${teamWord})` : ""}${s.dueInDays != null ? ` | ${s.dueInDays}` : ""}`);
    tasks.forEach((t, i) => t.stage === si && lines.push(taskLine(t, i)));
  });
  return lines.join("\n");
}
