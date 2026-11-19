/**
 * Plan mode output. The plan can arrive three ways: inside <plan></plan> in the reply (what the plan-mode
 * instructions ask for), in Claude Code's own plan file (written with the Write tool), or as a plain reply.
 * The first substantial one wins, and it's saved to plans/ for the owner to review before anything runs.
 */
import fs from "node:fs";
import path from "node:path";
import { AGENT_DIR } from "./paths";

const MIN_PLAN_CHARS = 200;

export function extractTaggedPlan(text: string | null | undefined): string | null {
  const match = text?.match(/<plan>([\s\S]*?)<\/plan>/);
  const plan = match?.[1]?.trim();
  return plan && plan.length >= MIN_PLAN_CHARS ? plan : null;
}

export type PlanSources = { replyTexts: string[]; planFileWrites: string[]; finalResult: string | null };

export function extractPlan({ replyTexts, planFileWrites, finalResult }: PlanSources): { plan: string; source: string } | null {
  const tagged = extractTaggedPlan(replyTexts.join("\n\n")) ?? extractTaggedPlan(finalResult);
  if (tagged) return { plan: tagged, source: "reply (<plan> tags)" };
  for (const content of [...planFileWrites].reverse()) {
    const plan = extractTaggedPlan(content) ?? (content.trim().length >= MIN_PLAN_CHARS ? content.trim() : null);
    if (plan) return { plan, source: "Claude Code plan file" };
  }
  const reply = (finalResult ?? replyTexts.join("\n\n")).trim();
  return reply.length >= MIN_PLAN_CHARS ? { plan: reply, source: "reply (no <plan> tags)" } : null;
}

export function savePlan(plan: { plan: string; source: string }, meta: { prompt: string; model: string; now?: Date }, dir = path.join(AGENT_DIR, "plans")): string {
  const now = meta.now ?? new Date();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `plan_${stamp}.md`);
  const body = [
    `# Plan: ${meta.prompt.replace(/\s+/g, " ").slice(0, 100)}`,
    "",
    `- Created: ${now.toISOString()}`,
    `- Model: ${meta.model}`,
    `- Source: ${plan.source}`,
    "",
    "---",
    "",
    plan.plan,
    "",
    "---",
    "",
    "_Made in plan mode and not executed. To carry it out, review it, then run the agent again with `--continue`._",
    "",
  ].join("\n");
  fs.writeFileSync(file, body);
  return file;
}
