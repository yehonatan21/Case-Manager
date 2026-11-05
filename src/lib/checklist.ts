/**
 * Document checklist of a case, computed from its documents (no server code: used by the portal and the
 * staff workspace too). A requested document counts as provided once the client uploaded something that
 * isn't waiting for a new version.
 */
import type { DocumentStatus } from "./db/schema";

export type ChecklistDoc = { id: string; title: string; status: DocumentStatus; visibility: "client" | "internal"; required: boolean; /** Asked for by the team (vs. uploaded on the client's own initiative). */ requested: boolean };

/** Waiting on the client. */
export const isOutstanding = (status: DocumentStatus) => status === "requested" || status === "needs_new_version";

export type Checklist = {
  /** Requested from the client (required + optional). */
  items: ChecklistDoc[];
  required: number;
  requiredProvided: number;
  optional: number;
  optionalProvided: number;
  approved: number;
  /** Required documents still missing (requested, or a new version asked for). */
  missing: ChecklistDoc[];
  complete: boolean;
};

export function documentChecklist(docs: ChecklistDoc[]): Checklist {
  // Only documents the team asked the client for: not internal files, not files the client added on their own.
  const items = docs.filter((x) => x.visibility === "client" && x.requested);
  const req = items.filter((x) => x.required);
  const opt = items.filter((x) => !x.required);
  const provided = (x: ChecklistDoc) => !isOutstanding(x.status);
  const missing = req.filter((x) => !provided(x));
  return {
    items,
    required: req.length,
    requiredProvided: req.filter(provided).length,
    optional: opt.length,
    optionalProvided: opt.filter(provided).length,
    approved: items.filter((x) => x.status === "approved").length,
    missing,
    complete: req.length > 0 && missing.length === 0,
  };
}

/** Case-insensitive, whitespace-insensitive title match, to avoid asking twice for the same document. */
export const sameTitle = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
