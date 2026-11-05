import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { documents, intakeSessions, type IntakeChatMessage, type IntakeSession, type IntakeSummary, type User } from "../db/schema";
import { AppError } from "../errors";
import { sha256 } from "../crypto";
import { aiIntakeTurn } from "../ai";
import { rateLimit } from "./rate-limit";
import { getSettings } from "./settings";
import { dictionaries } from "../i18n/dictionaries";
import type { Locale } from "../i18n/config";
import { categoriesForPrompt, categoryFromProposal, isKnownCategory, resolveCategory } from "./categories";

export const INTAKE_OWNER_COOKIE = "cm_intake_owner";
const MAX_TURNS = 40;

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function emptySummary(): IntakeSummary {
  return {
    request_title: "",
    request_description: "",
    service_category: "other",
    customer_goal: "",
    known_facts: [],
    constraints: [],
    missing_information: [],
    suggested_next_questions: [],
    urgency: "normal",
    needs_human_review: true,
    assumptions: [],
  };
}

export function canAccessIntake(session: IntakeSession, user: User | null, ownerToken: string | null): boolean {
  if (session.userId && user && session.userId === user.id) return true;
  if (session.ownerTokenHash && ownerToken && session.ownerTokenHash === sha256(ownerToken)) return true;
  return false;
}

export async function getIntake(db: DbOrTx, id: string, user: User | null, ownerToken: string | null): Promise<IntakeSession> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found");
  const [s] = await db.select().from(intakeSessions).where(eq(intakeSessions.id, id));
  if (!s || !canAccessIntake(s, user, ownerToken)) throw new AppError("not_found");
  return s;
}

/** Runs one assistant turn and persists it. On AI failure the customer's input is kept and `aiFailed` is set. */
async function runTurn(db: Database, session: IntakeSession, messages: IntakeChatMessage[], finishNow = false) {
  const settings = await getSettings(db);
  const locale = session.locale as Locale;
  const asked = messages.filter((m) => m.role === "assistant").length;
  try {
    const { turn } = await aiIntakeTurn(db, {
      intakeSessionId: session.id,
      userId: session.userId,
      locale,
      company: settings.company.name,
      messages,
      asked,
      limit: session.questionLimit,
      finishNow,
      skippedLabel: dictionaries[locale].intake.dontKnow,
      categories: await categoriesForPrompt(db),
    });
    // A new kind of service (no existing type fits): the proposed type is created, or matched to one with that name.
    const category =
      turn.summary.service_category === "new" || (turn.summary.new_service_type && !(await isKnownCategory(db, turn.summary.service_category)))
        ? await categoryFromProposal(db, turn.summary.new_service_type)
        : await resolveCategory(db, turn.summary.service_category);
    const { new_service_type: _proposal, ...rest } = turn.summary;
    void _proposal;
    const summary: IntakeSummary = { ...emptySummary(), ...rest, service_category: category };
    const assistantMsg: IntakeChatMessage = {
      id: newId(),
      role: "assistant",
      content: turn.reply,
      at: now(),
      quickReplies: turn.quick_replies,
      ...(turn.questionId ? { qid: turn.questionId } : {}),
    };
    const isQuestion = !turn.ready_for_review;
    const [updated] = await db
      .update(intakeSessions)
      .set({
        messages: [...messages, assistantMsg],
        summary,
        summaryVersion: session.summaryVersion + 1,
        questionCount: session.questionCount + (isQuestion ? 1 : 0),
        readyForReview: turn.ready_for_review,
        aiFailed: false,
        updatedAt: new Date(),
      })
      .where(eq(intakeSessions.id, session.id))
      .returning();
    return updated!;
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "ai_unavailable") throw err;
    const [updated] = await db
      .update(intakeSessions)
      .set({ messages, aiFailed: true, updatedAt: new Date() })
      .where(eq(intakeSessions.id, session.id))
      .returning();
    return updated!;
  }
}

export async function createIntake(
  db: Database,
  input: { message: string | null; locale: Locale; user: User | null; ownerToken: string; ip: string | null; mode: "chat" | "manual" },
) {
  if (input.ip) await rateLimit(db, `intake:create:${input.ip}`, 30, 3600);
  const settings = await getSettings(db);
  const [session] = await db
    .insert(intakeSessions)
    .values({
      ownerTokenHash: sha256(input.ownerToken),
      userId: input.user?.id ?? null,
      locale: input.locale,
      mode: input.mode,
      questionLimit: settings.intake_question_limit,
      messages: [],
      summary: input.mode === "manual" ? emptySummary() : null,
    })
    .returning();
  if (input.mode === "manual" || !input.message?.trim()) return session!;
  const first: IntakeChatMessage = { id: newId(), role: "user", content: input.message.trim().slice(0, 4000), at: now() };
  return runTurn(db, session!, [first]);
}

export async function postIntakeMessage(db: Database, session: IntakeSession, input: { content: string; skipped?: boolean; attachmentIds?: string[] }) {
  if (session.status !== "active") throw new AppError("conflict", "Intake already submitted");
  await rateLimit(db, `intake:turns:${session.id}`, MAX_TURNS, 24 * 3600);
  const msg: IntakeChatMessage = {
    id: newId(),
    role: "user",
    content: input.content.trim().slice(0, 4000),
    at: now(),
    ...(input.skipped ? { skipped: true } : {}),
    ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
  };
  const messages = [...session.messages, msg];
  // Extending past the default limit is allowed when the customer chooses to keep answering.
  if (session.readyForReview) {
    await db
      .update(intakeSessions)
      .set({ readyForReview: false, questionLimit: Math.max(session.questionLimit, session.questionCount + 3) })
      .where(eq(intakeSessions.id, session.id));
    session = { ...session, readyForReview: false, questionLimit: Math.max(session.questionLimit, session.questionCount + 3) };
  }
  return runTurn(db, session, messages);
}

/** Produces the final summary when the customer chooses to finish early. */
export async function finishIntake(db: Database, session: IntakeSession) {
  if (session.status !== "active") return session;
  if (session.readyForReview && session.summary) return session;
  if (session.messages.length === 0) return session;
  return runTurn(db, session, session.messages, true);
}

export async function retryIntake(db: Database, session: IntakeSession) {
  if (session.status !== "active" || !session.aiFailed) return session;
  return runTurn(db, session, session.messages);
}

/** Fallback summary built only from what the customer wrote (used when AI is unavailable). */
export function summaryFromMessages(session: IntakeSession): IntakeSummary {
  const userText = session.messages.filter((m) => m.role === "user" && !m.skipped).map((m) => m.content);
  return {
    ...emptySummary(),
    request_title: (userText[0] ?? "").slice(0, 80),
    request_description: userText.join("\n"),
    customer_goal: userText[0] ?? "",
  };
}

export async function intakeAttachments(db: DbOrTx, sessionId: string) {
  return db.select().from(documents).where(eq(documents.intakeSessionId, sessionId));
}
