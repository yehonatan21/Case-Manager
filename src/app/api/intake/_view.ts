import type { IntakeSession } from "@/lib/db/schema";

/** Fields of an intake session safe to return to its owner. */
export function publicIntake(s: IntakeSession) {
  return {
    id: s.id,
    status: s.status,
    mode: s.mode,
    messages: s.messages.map(({ qid: _qid, ...m }) => m),
    summary: s.summary,
    questionCount: s.questionCount,
    questionLimit: s.questionLimit,
    readyForReview: s.readyForReview,
    aiFailed: s.aiFailed,
    caseId: s.caseId,
  };
}
export type PublicIntake = ReturnType<typeof publicIntake>;
