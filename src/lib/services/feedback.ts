/**
 * Client satisfaction: once a case is completed, its client can rate the service (1–5) with an optional comment,
 * once per case. The team member handling it is told; the ratings feed the reports.
 */
import { eq } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { caseFeedback, type User } from "../db/schema";
import { AppError } from "../errors";
import { adminCaseLink, caseWithAccess } from "./cases";
import { addEvent } from "./events";
import { notify, staffRecipients } from "./notifications";
import { audit } from "./audit";

export async function getCaseFeedback(db: DbOrTx, caseId: string) {
  const [f] = await db.select().from(caseFeedback).where(eq(caseFeedback.caseId, caseId));
  return f ?? null;
}

export async function submitFeedback(db: Database, actor: User, caseId: string, input: { rating: number; comment?: string | null }) {
  const { c, access } = await caseWithAccess(db, actor, caseId);
  if (!access.isClient) throw new AppError("forbidden");
  if (!c.completedAt || !["completed", "closed"].includes(c.status)) throw new AppError("feedback_not_ready");
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new AppError("validation");
  const comment = input.comment?.trim().slice(0, 2000) || null;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(caseFeedback).values({ caseId: c.id, userId: actor.id, staffId: c.assigneeId, rating: input.rating, comment }).onConflictDoNothing().returning();
    if (!row) throw new AppError("feedback_exists");
    await addEvent(tx, { caseId: c.id, type: "feedback_given", actor, visibility: "internal", data: { rating: input.rating } });
    await notify(tx, {
      userIds: await staffRecipients(tx, c),
      type: "feedback_received",
      caseId: c.id,
      vars: { number: c.number, rating: input.rating, comment: comment ? comment.slice(0, 140) : "—" },
      link: adminCaseLink(c.id),
    });
    await audit(tx, { actorId: actor.id, action: "feedback.submit", entityType: "case", entityId: c.id, details: { rating: input.rating } });
    return row;
  });
}
