/** Quick runway math: how long the cash lasts at a given monthly cost and revenue. No database. */
import { runway } from "../lib/calc";
import { num, positional, runScript } from "../lib/run";

const USAGE = `node --import tsx scripts/simple-calculation.ts <cash> <monthly_costs> [monthly_revenue]
Amounts in major currency units, e.g.: node --import tsx scripts/simple-calculation.ts 400000 85000 70000`;

runScript(() => {
  const [cash, costs, revenue] = positional();
  if (cash === undefined || costs === undefined) throw new Error("give cash and monthly costs");
  return runway({ cash: num(cash, "cash")!, monthlyCosts: num(costs, "monthly_costs")!, monthlyRevenue: num(revenue, "monthly_revenue") ?? 0 });
}, USAGE);
