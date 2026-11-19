/**
 * Command line for the Chief of Staff. Progress goes to stderr and the answer to stdout, so the answer can
 * be piped or saved:
 *   npm run agent -- "What's our runway?"
 *   npm run agent -- --style technical "/budget-impact hiring one more case manager"
 *   npm run agent -- --plan "Plan how we cut first-response time to under 4 hours"
 *   npm run agent -- --continue "Go ahead with the plan"
 */
import { describeMessage } from "./lib/activity";

const USAGE = `Usage: npm run agent -- [options] "<question or /command>"

Options:
  --style <name>     Output style: executive (default), technical, or default (Claude's own)
  --plan             Plan mode: research and write a plan to plans/, change nothing
  --continue         Continue the most recent conversation
  --model <id>       Model (default: claude-opus-5-5, or CHIEF_OF_STAFF_MODEL)
  --budget <usd>     Stop once the run's estimated cost passes this many dollars
  --quiet            Don't print progress
  --help             Show this help

Commands: /weekly-brief, /budget-impact <decision>, /capacity-scan [focus], /strategic-brief <topic>`;

function parseArgs(argv: string[]) {
  const opts = { style: "executive", plan: false, continue: false, quiet: false, model: undefined as string | undefined, budget: undefined as number | undefined, prompt: "" };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return null;
    else if (a === "--style") opts.style = argv[++i] ?? opts.style;
    else if (a === "--plan") opts.plan = true;
    else if (a === "--continue") opts.continue = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--budget") opts.budget = Number(argv[++i]);
    else words.push(a);
  }
  opts.prompt = words.join(" ").trim();
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts || !opts.prompt) {
    console.log(USAGE);
    process.exit(opts ? 1 : 0);
  }
  if (opts.budget !== undefined && !(opts.budget > 0)) throw new Error("--budget must be a positive number of dollars");

  let agent: typeof import("./agent");
  try {
    agent = await import("./agent");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && String(err).includes("claude-agent-sdk")) {
      console.error("The Claude Agent SDK isn't installed yet. From the repository root, run:\n  npm --prefix agents/chief-of-staff install");
      process.exit(1);
    }
    throw err;
  }

  const { result, planFile } = await agent.sendQuery(opts.prompt, {
    permissionMode: opts.plan ? "plan" : "default",
    continueConversation: opts.continue,
    outputStyle: opts.style === "default" ? undefined : opts.style,
    model: opts.model,
    maxBudgetUsd: opts.budget,
    onMessage: (msg) => {
      if (!opts.quiet) for (const line of describeMessage(msg)) console.error(line);
    },
    onRefused: ({ tool, reason, subagent }) => {
      if (!opts.quiet) console.error(`${subagent ? "    " : ""}⛔ Refused ${tool}${subagent ? ` (${subagent})` : ""}: ${reason}`);
    },
  });
  if (result) console.log(result);
  if (planFile) console.error(`\n📁 Plan saved to ${planFile}\n   Review it, then run again with --continue to carry it out.`);
  if (!result) process.exit(1);
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
