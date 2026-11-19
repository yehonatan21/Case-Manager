# CLAUDE.md: Chief of Staff context

This folder is the workspace of the Chief of Staff agent (see README.md). This file is its standing context:
how the business works, where the numbers come from and which scripts to run. The numbers themselves are not
written here. They live in the Case Manager database (read live by the scripts) and in the owner's private
`data/business-profile.json`.

## The business

A service business that runs on Case Manager (an AI-assisted request, quote and case platform, in Hebrew and
English). Clients send a request, often through the AI intake chat; the team reviews it, sends a quote, the
client approves and pays online, and the team handles the case to completion. Typical services include
relocation, citizenship, business setup and other professional services. Each installation's services are
listed in `requests_by_service` in the snapshot.

- **Case lifecycle**: submitted → under_review → awaiting_information → quote_preparation → quote_sent →
  awaiting_payment → active → awaiting_client → completed → closed. A case can also be cancelled or declined.
  "Open" means anything before completed or closed.
- **Money in**: payments on approved quotes. Quotes carry VAT (18% by default). Revenue in the scripts is what
  clients actually paid in the period.
- **Money out**: the team's time (time entries × each person's hourly cost, where an admin has set it), case
  expenses (fees, translations, couriers), and the fixed costs and payroll in the business profile.
- **Service level**: the first-response SLA (24 hours unless changed in Settings) is the main promise to
  clients. Time to quote and time to complete come next.
- **The team**: admins (usually the owner), case managers (own cases), staff (work on tasks) and finance.

## Where the numbers come from

| Need | Source |
|---|---|
| Revenue, funnel, pipeline, SLA, team workload, satisfaction | `scripts/business-snapshot.ts` (live database, read-only) |
| Revenue trend and projections | `scripts/revenue-forecast.ts` |
| Cost and effect of hiring | `scripts/hiring-impact.ts` |
| Cash, fixed costs, payroll, targets, goals | `data/business-profile.json` (the owner fills it in; may be missing) |
| Outside benchmarks (salaries, typical fees) | WebSearch, never with client details |

The database scripts return aggregates only, with team members by name and no client details. If the
profile is missing, `business_profile.source` in the snapshot says so: tell the owner which numbers to add
(copy `data/business-profile.example.json` to `data/business-profile.json`).

## Scripts

Run each from this folder exactly as shown, one command per call. Bash is limited to this form: no pipes,
`&&`, `cd` or redirects. Every script prints JSON to stdout, and `--help` prints its usage. Amounts are in
major currency units (shekels, not agorot).

```bash
node --import tsx scripts/business-snapshot.ts --period 30d        # 7d | 30d | 90d | month | last_month | year
node --import tsx scripts/business-snapshot.ts --from 2026-01-01 --to 2026-03-31
node --import tsx scripts/revenue-forecast.ts --months 6 --history 6
node --import tsx scripts/hiring-impact.ts 1 17000 --one-time 4000  # hires, monthly cost per hire
node --import tsx scripts/simple-calculation.ts 400000 85000 70000  # cash, monthly costs, monthly revenue
node --import tsx scripts/decision-matrix.ts '{"criteria":[{"name":"cost","weight":3}],"options":[{"name":"A","scores":{"cost":7}}]}'
```

- **business-snapshot**: revenue (total, by month, by service), the pipeline right now, the funnel for
  requests opened in the period, service times against the SLA, delivery costs, the team's workload and
  client satisfaction.
- **revenue-forecast**: base, optimistic and pessimistic projections from full months of payments, plus the
  money expected from quotes already out at the recent approval rate. With little history it says so.
- **hiring-impact**: added monthly, annual and one-time cost; runway before and after (needs cash and costs);
  open cases per handler before and after; the extra paid cases a month needed to break even; and flags.
- **simple-calculation**: runway, net burn and daily burn from three numbers.
- **decision-matrix**: weighted scores (1–10 per criterion) with the winner and whether it's a close call.

## Working rules

- Measured beats estimated: run a script before stating a number, and give each number's period.
- Keep at least `minRunwayMonths` of runway (6 by default) unless the owner explicitly accepts the risk.
- Small samples: a few cases or months make patterns tentative, so say so.
- You can't change cases, quotes, payments or settings. Recommend the action in the app instead (assign a
  case, add a reply template or automation rule, adjust the SLA, follow up on a quote).
- Reports go in `output_reports/` (markdown, dated file names). Plan-mode plans are saved to `plans/` for
  review. `audit/` is written by hooks; don't edit it.
- Subagents: **financial-analyst** (money, runway, pricing, hiring cost) and **operations-analyst** (workload,
  SLA, bottlenecks, whether to hire).
- Slash commands: `/weekly-brief`, `/budget-impact <decision>`, `/capacity-scan [focus]`,
  `/strategic-brief <topic>`.
