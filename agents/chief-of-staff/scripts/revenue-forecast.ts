/**
 * Base / optimistic / pessimistic revenue for the coming months, from the last full months of payments
 * (read-only), plus what the quotes already out could bring in at the recent approval rate.
 */
import "../lib/env";
import { revenueForecast } from "../lib/calc";
import { gatherRevenueHistory, readOnly } from "../lib/data";
import { flag, num, runScript } from "../lib/run";

const USAGE = `node --import tsx scripts/revenue-forecast.ts [--months 6] [--history 6]
--months: months to project (1-36); --history: full months of history to base it on (2-24).`;

runScript(async () => {
  const months = num(flag("months"), "months") ?? 6;
  const historyMonths = num(flag("history"), "history") ?? 6;
  if (!Number.isInteger(historyMonths) || historyMonths < 2 || historyMonths > 24) throw new Error("history must be 2-24 months");
  const data = await readOnly((db) => gatherRevenueHistory(db, historyMonths));
  return {
    currency: data.currency,
    history_window: data.window,
    history: data.history,
    data_source: data.data_source,
    forecast: revenueForecast({
      history: data.history,
      months,
      pipeline: { openQuoteValue: data.open_quotes.value, approvalRate: data.approval_rate_last_90_days },
    }),
  };
}, USAGE);
