import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { caseEvents, cases, type EventData, type User } from "../db/schema";
import { isStaffRole } from "../domain";

export type EventType =
  | "case_submitted"
  | "case_opened_by_staff"
  | "assigned"
  | "unassigned"
  | "status_changed"
  | "info_requested"
  | "client_responded"
  | "document_requested"
  | "documents_requested"
  | "documents_reminder"
  | "document_uploaded"
  | "document_reviewed"
  | "signature_requested"
  | "signature_cancelled"
  | "document_signed"
  | "meeting_booked"
  | "meeting_cancelled"
  | "meeting_moved"
  | "quote_sent"
  | "quote_approved"
  | "quote_declined"
  | "quote_clarification"
  | "payment_succeeded"
  | "payment_failed"
  | "task_completed"
  | "tasks_created"
  | "client_update"
  | "case_completed"
  | "case_closed"
  | "ai_summary"
  | "urgency_changed";

/** Record a case event. Every material action creates one (who, what, when, and who may see it). */
export async function addEvent(
  db: DbOrTx,
  e: { caseId: string; type: EventType; actor?: Pick<User, "id" | "role"> | null; actorKind?: "customer" | "staff" | "system" | "ai"; visibility: "client" | "internal"; data?: EventData },
) {
  const actorKind = e.actorKind ?? (e.actor ? (isStaffRole(e.actor.role) ? "staff" : "customer") : "system");
  await db.insert(caseEvents).values({
    caseId: e.caseId,
    type: e.type,
    actorId: e.actor?.id ?? null,
    actorKind,
    visibility: e.visibility,
    data: e.data ?? {},
  });
  const now = new Date();
  await db
    .update(cases)
    .set(
      actorKind === "customer"
        ? { updatedAt: now, lastClientActivityAt: now }
        : actorKind === "staff"
          ? { updatedAt: now, lastStaffActivityAt: now }
          : { updatedAt: now },
    )
    .where(eq(cases.id, e.caseId));
}
