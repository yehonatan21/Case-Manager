/**
 * What hiring N people would do to monthly costs, runway, caseload per handler and the extra paid cases
 * needed to break even. Team and revenue come from the database (read-only), cash and costs from the
 * business profile; anything given on the command line wins.
 */
import "../lib/env";
import { hiringImpact } from "../lib/calc";
import { gatherCapacity, readOnly } from "../lib/data";
import { loadProfile, monthlyCosts } from "../lib/profile";
import { flag, num, positional, runScript } from "../lib/run";

const USAGE = `node --import tsx scripts/hiring-impact.ts <hires> [monthly_cost_per_hire] [--one-time N] [--ramp-months N] [--cash N] [--monthly-costs N]
Example: node --import tsx scripts/hiring-impact.ts 1 18000 --one-time 5000
Without a monthly cost per hire: the profile's defaultMonthlyCostPerHire, else the team's average hourly cost x monthlyHoursPerFte.`;

runScript(async () => {
  const [hiresArg, costArg] = positional();
  const hires = num(hiresArg, "hires");
  if (hires === undefined) throw new Error("give the number of hires");
  const capacity = await readOnly((db) => gatherCapacity(db));
  const { profile, source } = loadProfile();

  let costPerHire = num(costArg, "monthly_cost_per_hire");
  let costSource = "command line";
  if (costPerHire === undefined && profile.defaultMonthlyCostPerHire !== null) {
    costPerHire = profile.defaultMonthlyCostPerHire;
    costSource = "business profile (defaultMonthlyCostPerHire)";
  }
  if (costPerHire === undefined && capacity.average_hourly_cost !== null) {
    costPerHire = Math.round(capacity.average_hourly_cost * profile.monthlyHoursPerFte);
    costSource = `team average hourly cost (${capacity.average_hourly_cost}) x ${profile.monthlyHoursPerFte} hours`;
  }
  if (costPerHire === undefined) {
    throw new Error("no monthly cost per hire: pass it as the second argument, or set defaultMonthlyCostPerHire in data/business-profile.json");
  }
  const cash = num(flag("cash"), "cash") ?? profile.cashOnHand;
  const costs = num(flag("monthly-costs"), "monthly costs") ?? monthlyCosts(profile);

  return {
    inputs: {
      hires,
      monthly_cost_per_hire: costPerHire,
      monthly_cost_source: costSource,
      cash,
      monthly_costs: costs,
      monthly_revenue: capacity.monthly_average.revenue,
      revenue_per_paid_case: capacity.average_payment,
      profile_source: source,
      currency: capacity.currency,
    },
    capacity,
    impact: hiringImpact({
      hires,
      monthlyCostPerHire: costPerHire,
      oneTimeCostPerHire: num(flag("one-time"), "one-time cost"),
      rampMonths: num(flag("ramp-months"), "ramp months"),
      openCases: capacity.open_cases,
      handlers: capacity.handlers,
      monthlyRevenue: capacity.monthly_average.revenue,
      revenuePerPaidCase: capacity.average_payment,
      monthlyCosts: costs,
      cash,
      minRunwayMonths: profile.minRunwayMonths,
      targetOpenCasesPerHandler: profile.targetOpenCasesPerHandler,
    }),
  };
}, USAGE);
