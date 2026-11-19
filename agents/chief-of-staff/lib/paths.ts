import path from "node:path";
import { fileURLToPath } from "node:url";

/** This agent's folder: its working directory, where CLAUDE.md and .claude/ live. */
export const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The Case Manager repository root (the app whose data the agent reads). */
export const REPO_ROOT = path.resolve(AGENT_DIR, "../..");

/** Folders (relative to AGENT_DIR) the agent may write to: reports and saved plans. */
export const WRITABLE_DIRS = ["output_reports", "plans"];
/** The owner's private numbers (gitignored); the agent may also help fill it in. */
export const PROFILE_FILE = path.join(AGENT_DIR, "data", "business-profile.json");

/** True when `target` is `dir` itself or inside it. */
export const isInside = (target: string, dir: string) => {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
