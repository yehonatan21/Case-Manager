# Chief of Staff agent

An AI chief of staff for the business that runs Case Manager. Ask it about money, capacity, the team and the
pipeline, and it answers from the app's own data: revenue, quotes, response times against the SLA,
workload and runway, with a recommendation.

It's Anthropic's cookbook agent
[The chief of staff agent](https://platform.claude.com/cookbook/claude-agent-sdk-01-the-chief-of-staff-agent)
([notebook](https://github.com/anthropics/claude-cookbooks/blob/main/claude_agent_sdk/01_The_chief_of_staff_agent.ipynb)),
rebuilt in TypeScript on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk). The cookbook's
demo startup ("TechStart") and sample CSVs are replaced by scripts that read the live Case Manager database,
read-only.

```bash
npm run agent -- "What's our runway, and can we afford another case manager?"
npm run agent -- "/weekly-brief"
npm run agent -- --plan "Plan how we bring first-response time under 4 hours"
```

## Setup

The agent runs on your machine (or any server with Node 20+), not inside the web app.

1. **Install its SDK** (once, from the repository root). It's a separate install so the app's own installs,
   CI and deploys don't download the Claude Code binary (~300 MB):
   ```bash
   npm --prefix agents/chief-of-staff install
   ```
2. **Credentials**: set `ANTHROPIC_API_KEY`, either in the repository's `.env` (the variable the app's AI
   features use) or in your shell.
3. **Data**: with `DATABASE_URL` in `.env`, the agent reads that Postgres database. Without it, it reads the
   local embedded database (`.data/pglite`), so run the app once (`npm run dev`) or seed it
   (`npm run db:seed -- --demo`). For production data, a read-only database user is a good idea; the
   agent's queries run in a read-only transaction either way.
4. **Optional, your numbers**: the database doesn't know your cash, rent or payroll. Copy
   `data/business-profile.example.json` to `data/business-profile.json` and fill in what you know. That copy
   is gitignored. Without it, the agent says what it couldn't calculate (runway, for example).

## Using it

```bash
npm run agent -- [options] "<question or /command>"
```

| Option | |
|---|---|
| `--style executive` (default) · `technical` · `default` | How the answer is written (see `.claude/output-styles/`) |
| `--plan` | Plan mode: research and write a plan to `plans/`, change nothing |
| `--continue` | Continue the last conversation, e.g. to carry out a plan you reviewed |
| `--model <id>` | Default `claude-opus-5-5` (or `CHIEF_OF_STAFF_MODEL`) |
| `--budget <usd>` | Stop the run once its estimated cost passes this |
| `--quiet` | Only the answer (progress goes to stderr, the answer to stdout) |

Slash commands (in `.claude/commands/`):

| Command | |
|---|---|
| `/weekly-brief` | This week against the last 30 days, what needs attention, three things to do |
| `/budget-impact <decision>` | Cost, runway and payback of a decision (financial-analyst) |
| `/capacity-scan [focus]` | Workload, SLA, bottlenecks, whether to hire (operations-analyst) |
| `/strategic-brief <topic>` | Board-style brief combining both analysts |

From code:

```ts
import { sendQuery } from "./agents/chief-of-staff/agent";

const { result, planFile, costUsd } = await sendQuery("/budget-impact hiring a part-time bookkeeper", {
  outputStyle: "executive",
  onMessage: (msg) => { /* stream progress */ },
});
```

## How the cookbook's features map here

| Cookbook feature | Here |
|---|---|
| Memory (`CLAUDE.md`) | [`CLAUDE.md`](CLAUDE.md): how the business and its data work and which scripts to run (no hard-coded numbers) |
| Bash + Python scripts | [`scripts/`](scripts): `business-snapshot`, `revenue-forecast`, `hiring-impact`, `simple-calculation`, `decision-matrix` (TypeScript, JSON out) |
| Output styles | [`.claude/output-styles/`](.claude/output-styles): `executive`, `technical` |
| Plan mode | `--plan`: the plan is captured (from `<plan>` tags, Claude Code's plan file, or the reply) and saved to `plans/` |
| Slash commands | [`.claude/commands/`](.claude/commands) |
| Hooks | [`.claude/settings.json`](.claude/settings.json): script runs → `audit/script_usage_log.json`, report writes → `audit/report_history.json` |
| Subagents | [`.claude/agents/`](.claude/agents): `financial-analyst` (in place of the cookbook's financial analyst), `operations-analyst` (in place of its recruiter) |
| `agent.py` `send_query()` | [`agent.ts`](agent.ts) `sendQuery()`, with [`cli.ts`](cli.ts) for the terminal |

## Scripts

Run from this folder; each prints JSON and takes `--help`. Amounts are in major currency units.

| Script | What it returns |
|---|---|
| `node --import tsx scripts/business-snapshot.ts --period 30d` | Revenue (by month and service), the pipeline now, the request → quote → payment funnel, response times against the SLA, delivery costs, team workload, satisfaction |
| `node --import tsx scripts/revenue-forecast.ts --months 6` | Base, optimistic and pessimistic revenue, plus what the quotes already out could bring in |
| `node --import tsx scripts/hiring-impact.ts 1 17000` | Added cost, runway before and after, caseload per handler, break-even paid cases a month |
| `node --import tsx scripts/simple-calculation.ts 400000 85000 70000` | Runway from cash, monthly costs and revenue |
| `node --import tsx scripts/decision-matrix.ts '<json>'` | Weighted scoring of options |

## Safety and privacy

- **Read-only.** Postgres queries run in a `READ ONLY` transaction; the embedded database is read through a
  throwaway copy, so a running app isn't disturbed. The agent can't change cases, quotes, payments or
  settings.
- **Aggregates only.** The scripts return totals, rates and per-team-member workload. No client names,
  contact details or case contents go to the model.
- **Tool policy** ([`lib/policy.ts`](lib/policy.ts)), enforced in a `PreToolUse` hook on every call,
  subagents included: Bash runs only `node --import tsx scripts/<name>.ts …` with no pipes, chaining or
  redirects; reading and searching are limited to this folder (never `.env` or `node_modules`); writing only
  to `output_reports/`, `plans/` and `data/business-profile.json`; delegation only to the two subagents
  above. Plan mode changes nothing. Refused calls show as ⛔ in the progress output.
- **Your settings stay out.** Only this folder's `.claude/` is loaded (`settingSources: ["project"]`), not
  your personal `~/.claude`.
- `audit/`, `output_reports/`, `plans/` and `data/business-profile.json` are gitignored.

## Tests

`tests/chief-of-staff.test.ts` (part of `npm test`) covers the calculations, the tool policy (including
shell-injection attempts), plan capture, the business profile, and the data layer against a test database,
including that nothing it returns contains client details and that writes fail. To typecheck this folder
with the SDK installed:

```bash
npm --prefix agents/chief-of-staff run typecheck
```
