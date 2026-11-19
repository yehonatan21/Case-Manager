/**
 * The business at a glance: revenue, pipeline, request funnel, response times vs. SLA, delivery costs,
 * team workload and client satisfaction, read live from the Case Manager database (read-only).
 */
import "../lib/env";
import { gatherSnapshot, readOnly } from "../lib/data";
import { loadProfile } from "../lib/profile";
import { flag, runScript } from "../lib/run";
import { resolvePeriod } from "../../../src/lib/services/reports";

const USAGE = `node --import tsx scripts/business-snapshot.ts [--period 7d|30d|90d|month|last_month|year] [--from YYYY-MM-DD --to YYYY-MM-DD]
Default period: last 30 days (Israel time).`;

runScript(async () => {
  const period = resolvePeriod({ preset: flag("period"), from: flag("from"), to: flag("to") });
  const snapshot = await readOnly((db) => gatherSnapshot(db, period));
  const { profile, source } = loadProfile();
  return { ...snapshot, business_profile: { source, ...profile } };
}, USAGE);
