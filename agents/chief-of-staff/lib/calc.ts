/**
 * Pure calculations behind the Chief of Staff scripts: runway, hiring impact, revenue forecast and a weighted
 * decision matrix. No database, no I/O, so they are unit-tested (tests/chief-of-staff.test.ts) and the scripts
 * only gather inputs and print the result.
 *
 * Money is in major currency units (shekels, dollars), not cents.
 */

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const DAYS_PER_MONTH = 30.44;

// ---------------------------------------------------------------- runway

export type RunwayInput = { cash: number; monthlyCosts: number; monthlyRevenue?: number };

export function runway({ cash, monthlyCosts, monthlyRevenue = 0 }: RunwayInput) {
  if (![cash, monthlyCosts, monthlyRevenue].every(Number.isFinite)) throw new Error("cash, monthly costs and revenue must be numbers");
  const netBurn = monthlyCosts - monthlyRevenue;
  const positive = netBurn <= 0;
  return {
    cash: round(cash),
    monthly_costs: round(monthlyCosts),
    monthly_revenue: round(monthlyRevenue),
    net_monthly_burn: round(netBurn),
    cash_flow_positive: positive,
    // No runway limit while revenue covers costs.
    runway_months: positive ? null : round(cash / netBurn, 1),
    quarterly_net_burn: round(netBurn * 3),
    daily_net_burn: round(netBurn / DAYS_PER_MONTH),
  };
}

// ---------------------------------------------------------------- hiring impact

export type HiringInput = {
  hires: number;
  /** Fully loaded monthly cost of one hire (salary, employer taxes, benefits, equipment). */
  monthlyCostPerHire: number;
  /** One-time cost per hire (recruiting, onboarding, equipment). */
  oneTimeCostPerHire?: number;
  /** Months until a new hire carries a full caseload. */
  rampMonths?: number;
  openCases: number;
  /** Team members who handle cases today (active admins, case managers and staff). */
  handlers: number;
  /** Average monthly revenue over recent full months, if known. */
  monthlyRevenue: number | null;
  /** Average revenue per paid case over recent months, if known. */
  revenuePerPaidCase: number | null;
  /** Monthly costs today (from the business profile), if known. */
  monthlyCosts: number | null;
  cash: number | null;
  minRunwayMonths?: number;
  targetOpenCasesPerHandler?: number | null;
};

export function hiringImpact(i: HiringInput) {
  if (!Number.isInteger(i.hires) || i.hires < 1) throw new Error("hires must be a whole number of at least 1");
  if (!(i.monthlyCostPerHire > 0)) throw new Error("monthly cost per hire must be positive");
  const ramp = i.rampMonths ?? 2;
  const minRunway = i.minRunwayMonths ?? 6;
  const addedMonthly = i.hires * i.monthlyCostPerHire;
  const addedOneTime = i.hires * (i.oneTimeCostPerHire ?? 0);
  const perHandlerNow = i.handlers > 0 ? i.openCases / i.handlers : null;
  const perHandlerAfter = i.openCases / (i.handlers + i.hires);

  let before: ReturnType<typeof runway> | null = null;
  let after: ReturnType<typeof runway> | null = null;
  if (i.cash !== null && i.monthlyCosts !== null) {
    before = runway({ cash: i.cash, monthlyCosts: i.monthlyCosts, monthlyRevenue: i.monthlyRevenue ?? 0 });
    after = runway({ cash: i.cash - addedOneTime, monthlyCosts: i.monthlyCosts + addedMonthly, monthlyRevenue: i.monthlyRevenue ?? 0 });
  }

  const flags: string[] = [];
  if (after && !after.cash_flow_positive && after.runway_months !== null && after.runway_months < minRunway) {
    flags.push(`runway would fall below the ${minRunway}-month minimum (${after.runway_months} months)`);
  }
  if (before?.cash_flow_positive && after && !after.cash_flow_positive) flags.push("the business would go from cash-flow positive to burning cash");
  if (i.targetOpenCasesPerHandler && perHandlerNow !== null) {
    if (perHandlerNow > i.targetOpenCasesPerHandler) flags.push(`the team is over the target of ${i.targetOpenCasesPerHandler} open cases per handler (${round(perHandlerNow, 1)})`);
    if (perHandlerAfter < i.targetOpenCasesPerHandler * 0.6) flags.push(`after hiring, caseload would be well under target (${round(perHandlerAfter, 1)} per handler)`);
  }
  if (i.cash === null || i.monthlyCosts === null) flags.push("runway not calculated: set cashOnHand and monthly costs in data/business-profile.json");
  if (i.revenuePerPaidCase === null) flags.push("break-even not calculated: no paid cases in the recent months");

  return {
    hires: i.hires,
    added_monthly_cost: round(addedMonthly),
    added_annual_cost: round(addedMonthly * 12),
    added_one_time_cost: round(addedOneTime),
    // Cost carried before the new hires are at full speed.
    ramp_up_cost: round(addedMonthly * ramp),
    open_cases_per_handler_now: perHandlerNow === null ? null : round(perHandlerNow, 1),
    open_cases_per_handler_after: round(perHandlerAfter, 1),
    break_even_extra_paid_cases_per_month: i.revenuePerPaidCase ? Math.ceil(addedMonthly / i.revenuePerPaidCase) : null,
    runway_before: before,
    runway_after: after,
    runway_change_months:
      before?.runway_months != null && after?.runway_months != null ? round(after.runway_months - before.runway_months, 1) : null,
    flags,
  };
}

// ---------------------------------------------------------------- revenue forecast

export type MonthTotal = { month: string; total: number };

/** Month-over-month growth rates, skipping months that follow a zero month (growth from zero is undefined). */
export function monthlyGrowthRates(history: MonthTotal[]): number[] {
  const rates: number[] = [];
  for (let k = 1; k < history.length; k++) {
    const prev = history[k - 1]!.total;
    if (prev > 0) rates.push(history[k]!.total / prev - 1);
  }
  return rates;
}

const nextMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
};

export type ForecastInput = {
  /** Full months only, oldest first. */
  history: MonthTotal[];
  months: number;
  /** Quotes sent and waiting for an answer, and the share of sent quotes that got approved recently. */
  pipeline?: { openQuoteValue: number; approvalRate: number | null };
};

/**
 * Base / optimistic / pessimistic projections. Growth is the median month-over-month rate (clamped to ±30%
 * so one odd month doesn't run away), the spread is its standard deviation (at least 5 points), and the
 * starting level is the average of the last three months.
 */
export function revenueForecast({ history, months, pipeline }: ForecastInput) {
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new Error("months must be between 1 and 36");
  const nonEmpty = history.filter((h) => h.total > 0);
  const rates = monthlyGrowthRates(history);
  const sorted = [...rates].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2) : 0;
  const clamp = (g: number) => Math.max(-0.3, Math.min(0.3, g));
  const base = clamp(median);
  const avgRate = mean(rates) ?? 0;
  const sd = rates.length > 1 ? Math.sqrt(sum(rates.map((r) => (r - avgRate) ** 2)) / (rates.length - 1)) : 0;
  const spread = Math.max(0.05, Math.min(0.3, sd));
  const start = mean(history.slice(-3).map((h) => h.total)) ?? 0;

  const scenario = (g: number) => {
    let m = history.length ? history[history.length - 1]!.month : new Date().toISOString().slice(0, 7);
    const out: MonthTotal[] = [];
    for (let k = 1; k <= months; k++) {
      m = nextMonth(m);
      out.push({ month: m, total: round(start * (1 + g) ** k) });
    }
    return { monthly_growth: round(g, 4), months: out, total: round(sum(out.map((o) => o.total))) };
  };

  const confidence = nonEmpty.length >= 6 && rates.length >= 5 ? "medium" : nonEmpty.length >= 3 ? "low" : "very low";
  return {
    history_months: history.length,
    months_with_revenue: nonEmpty.length,
    starting_monthly_level: round(start),
    confidence,
    base: scenario(base),
    optimistic: scenario(clamp(base + spread)),
    pessimistic: scenario(clamp(base - spread)),
    pipeline: pipeline
      ? {
          open_quote_value: round(pipeline.openQuoteValue),
          approval_rate: pipeline.approvalRate === null ? null : round(pipeline.approvalRate, 3),
          // Near-term money expected from quotes already out, if they convert at the recent rate.
          expected_from_open_quotes: pipeline.approvalRate === null ? null : round(pipeline.openQuoteValue * pipeline.approvalRate),
        }
      : null,
    notes: [
      "Projections extend the recent trend; they are not a budget.",
      ...(nonEmpty.length === 0
        ? ["No payments in the history window, so there is no trend to project: try a longer --history, or rely on the open quote pipeline."]
        : confidence !== "medium"
          ? ["Little history: treat the scenarios as a rough range."]
          : []),
    ],
  };
}

// ---------------------------------------------------------------- decision matrix

export type DecisionInput = {
  criteria: { name: string; weight: number }[];
  options: { name: string; scores: Record<string, number> }[];
};

/** Weighted scoring of options (scores 1–10 per criterion; weights are normalised). */
export function decisionMatrix({ criteria, options }: DecisionInput) {
  if (!criteria?.length || !options?.length) throw new Error("give at least one criterion and one option");
  const totalWeight = sum(criteria.map((c) => c.weight));
  if (!(totalWeight > 0) || criteria.some((c) => !(c.weight >= 0))) throw new Error("weights must be zero or more, with a positive total");
  const ranked = options
    .map((o) => {
      const contributions = criteria.map((c) => {
        const score = o.scores[c.name];
        if (typeof score !== "number" || score < 1 || score > 10) throw new Error(`option "${o.name}" needs a 1-10 score for "${c.name}"`);
        return { criterion: c.name, score, weight: round(c.weight / totalWeight, 3), contribution: round((score * c.weight) / totalWeight, 3) };
      });
      return { option: o.name, weighted_score: round(sum(contributions.map((x) => x.contribution)), 2), contributions };
    })
    .sort((a, b) => b.weighted_score - a.weighted_score);
  const margin = ranked.length > 1 ? round(ranked[0]!.weighted_score - ranked[1]!.weighted_score, 2) : null;
  return {
    winner: ranked[0]!.option,
    margin_over_runner_up: margin,
    // Within half a point on a 10-point scale the ranking depends on the exact weights.
    close_call: margin !== null && margin < 0.5,
    ranked,
  };
}
