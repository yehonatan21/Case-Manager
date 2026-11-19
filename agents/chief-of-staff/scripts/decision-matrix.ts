/** Weighted decision matrix for a strategic choice (e.g. hire vs. outsource, new service line). No database. */
import fs from "node:fs";
import path from "node:path";
import { decisionMatrix, type DecisionInput } from "../lib/calc";
import { AGENT_DIR, isInside } from "../lib/paths";
import { flag, positional, runScript } from "../lib/run";

const USAGE = `node --import tsx scripts/decision-matrix.ts '<json>'   or   --file plans/<name>.json
JSON: {"criteria":[{"name":"cost","weight":3},{"name":"speed","weight":2}],
       "options":[{"name":"Hire","scores":{"cost":4,"speed":8}},{"name":"Outsource","scores":{"cost":7,"speed":6}}]}
Scores 1-10 (10 = best); weights are relative.`;

runScript(() => {
  const file = flag("file");
  let raw: string | undefined;
  if (file) {
    const full = path.resolve(AGENT_DIR, file);
    if (!isInside(full, AGENT_DIR)) throw new Error("--file must be inside the agent folder");
    raw = fs.readFileSync(full, "utf8");
  } else {
    raw = positional()[0];
  }
  if (!raw) throw new Error("give the decision as JSON");
  return decisionMatrix(JSON.parse(raw) as DecisionInput);
}, USAGE);
