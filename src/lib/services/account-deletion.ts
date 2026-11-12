/**
 * Deleting a client's account: by the client (Profile → Delete account, or /delete-account) or by an admin at the
 * client's request. Required by Google Play and Apple for apps where people create accounts.
 *
 * Erased: the client's name, email, phone and WhatsApp number; sign-in, sessions and devices; notifications;
 * intake conversations; and every case without a payment, entirely (messages, documents and files, meetings,
 * signatures, tasks, history).
 *
 * Kept, as the law requires for financial records: payments and their invoices/receipts (including the invoice
 * PDFs), and for each paid case only what they stand on — the case number, the quote and its items. Those cases
 * lose their title, description, messages, other documents, meetings, signatures and history, and are closed.
 *
 * The user row stays, anonymized and disabled, so the kept records still point at something. The email address is
 * freed: the person can sign up again later as a new client.
 */
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import type { Database } from "../db";
import * as s from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { renderEmail, sendEmail } from "../email";
import { storage } from "../storage";
import { audit } from "./audit";
import { normalizeEmail } from "./users";

/** The title a kept (paid) case gets: its number stays, what it was about doesn't. */
export const DELETED_CASE_TITLE = "—";
/** The name an erased account shows wherever it still appears (payments, the activity log). */
export const DELETED_USER_NAME = "—";

const OPEN = new Set(["draft", "submitted", "under_review", "awaiting_information", "quote_preparation", "quote_sent", "awaiting_payment", "active", "awaiting_client"]);

export type DeletionSummary = { erasedCases: number; keptCases: number; files: number };

/** What deleting would do, shown before the person confirms. */
export async function deletionPreview(db: Database, userId: string) {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.userId, userId));
  if (!customer) return { cases: 0, paidCases: 0, openCases: 0 };
  const cases = await db.select({ id: s.cases.id, status: s.cases.status }).from(s.cases).where(eq(s.cases.customerId, customer.id));
  const ids = cases.map((c) => c.id);
  const paid = ids.length ? await db.selectDistinct({ caseId: s.payments.caseId }).from(s.payments).where(inArray(s.payments.caseId, ids)) : [];
  return { cases: cases.length, paidCases: paid.length, openCases: cases.filter((c) => OPEN.has(c.status)).length };
}

/**
 * Deletes `targetId`'s account. `actor` is the client themselves, or an admin. `confirmEmail` must be the
 * account's email address (typed by the person, so it can't happen by a stray click).
 */
export async function deleteCustomerAccount(db: Database, actor: s.User, targetId: string, confirmEmail: string, meta: { ip?: string | null } = {}): Promise<DeletionSummary> {
  if (actor.id !== targetId && actor.role !== "admin") throw new AppError("forbidden");
  const [target] = await db.select().from(s.users).where(eq(s.users.id, targetId));
  if (!target || target.deletedAt) throw new AppError("not_found");
  // Team members' accounts are disabled by an admin (Settings → Users), not deleted: their work stays attributed.
  if (target.role !== "customer") throw new AppError("forbidden", "Only client accounts can be deleted");
  if (normalizeEmail(confirmEmail) !== normalizeEmail(target.email)) throw new AppError("validation", "The email address doesn't match", { field: "confirm" });

  const files: string[] = [];
  const summary: DeletionSummary = { erasedCases: 0, keptCases: 0, files: 0 };

  await db.transaction(async (txAny) => {
    const tx = txAny as unknown as Database;
    const [customer] = await tx.select().from(s.customers).where(eq(s.customers.userId, target.id));
    const caseIds = customer ? (await tx.select({ id: s.cases.id }).from(s.cases).where(eq(s.cases.customerId, customer.id))).map((c) => c.id) : [];
    const paidIds = caseIds.length ? (await tx.selectDistinct({ caseId: s.payments.caseId }).from(s.payments).where(inArray(s.payments.caseId, caseIds))).map((p) => p.caseId) : [];
    const keep = new Set(paidIds);
    const erase = caseIds.filter((id) => !keep.has(id));
    summary.erasedCases = erase.length;
    summary.keptCases = keep.size;

    // Invoice and receipt PDFs saved to the case: kept with the invoices.
    const invoiceDocIds = paidIds.length
      ? (await tx.select({ id: s.invoices.documentId }).from(s.invoices).where(and(inArray(s.invoices.caseId, paidIds), isNotNull(s.invoices.documentId)))).map((r) => r.id!)
      : [];
    const intakeIds = (await tx.select({ id: s.intakeSessions.id }).from(s.intakeSessions).where(eq(s.intakeSessions.userId, target.id))).map((r) => r.id);

    // The documents going away, and their stored files (removed from storage once the transaction commits).
    const docConds = [
      erase.length ? inArray(s.documents.caseId, erase) : null,
      paidIds.length ? (invoiceDocIds.length ? and(inArray(s.documents.caseId, paidIds), notInArray(s.documents.id, invoiceDocIds)) : inArray(s.documents.caseId, paidIds)) : null,
      intakeIds.length ? inArray(s.documents.intakeSessionId, intakeIds) : null,
    ].filter((c) => c !== null);
    const docIds = [];
    for (const cond of docConds) docIds.push(...(await tx.select({ id: s.documents.id }).from(s.documents).where(cond!)).map((d) => d.id));
    if (docIds.length) {
      files.push(...(await tx.select({ key: s.documentFiles.storageKey }).from(s.documentFiles).where(inArray(s.documentFiles.documentId, docIds))).map((f) => f.key));
      await tx.delete(s.documents).where(inArray(s.documents.id, docIds)); // files and signatures cascade
    }

    // Cases without a payment: everything about them.
    if (erase.length) {
      await tx.delete(s.aiRuns).where(inArray(s.aiRuns.caseId, erase));
      await tx.delete(s.cases).where(inArray(s.cases.id, erase)); // events, messages, quotes, meetings, tasks, time… cascade
    }

    // Paid cases: only what the payment records stand on.
    if (paidIds.length) {
      for (const t of [s.messages, s.caseEvents, s.meetings, s.signatures, s.caseFeedback, s.caseReads, s.caseMilestones, s.tasks] as const) {
        await tx.delete(t).where(inArray(t.caseId, paidIds));
      }
      await tx.delete(s.aiRuns).where(inArray(s.aiRuns.caseId, paidIds));
      await tx.update(s.quotes).set({ approvalIp: null, declineReason: null }).where(inArray(s.quotes.caseId, paidIds));
      const kept = await tx.select({ id: s.cases.id, status: s.cases.status }).from(s.cases).where(inArray(s.cases.id, paidIds));
      for (const c of kept) {
        await tx
          .update(s.cases)
          .set({
            title: DELETED_CASE_TITLE,
            description: "",
            goal: "",
            intakeSummary: null,
            aiSummary: null,
            intakeSessionId: null,
            waitingNote: null,
            waitingOnThirdParty: false,
            dueDate: null,
            ...(OPEN.has(c.status) ? { status: "cancelled" as const, closedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(s.cases.id, c.id));
      }
    }

    // The intake conversations.
    if (intakeIds.length) {
      await tx.delete(s.aiRuns).where(inArray(s.aiRuns.intakeSessionId, intakeIds));
      await tx.delete(s.intakeSessions).where(inArray(s.intakeSessions.id, intakeIds));
    }

    // Everything else that is about this person.
    await tx.delete(s.aiRuns).where(eq(s.aiRuns.userId, target.id));
    for (const t of [s.sessions, s.notifications, s.pushSubscriptions, s.nativePushTokens, s.appSignIns, s.savedViews, s.caseReads, s.caseFeedback] as const) {
      await tx.delete(t).where(eq(t.userId, target.id));
    }
    await tx.delete(s.authCodes).where(eq(s.authCodes.email, normalizeEmail(target.email)));
    // Meetings in a colleague's (company) case they were invited to stay with that case, without them.
    await tx.update(s.meetings).set({ clientUserId: null }).where(eq(s.meetings.clientUserId, target.id));
    if (customer) await tx.update(s.customers).set({ notes: null, organizationId: null }).where(eq(s.customers.id, customer.id));

    await tx
      .update(s.users)
      .set({
        email: `deleted-${target.id}@deleted.invalid`,
        name: DELETED_USER_NAME,
        phone: null,
        whatsappPhone: null,
        whatsappOptInAt: null,
        whatsappLastInboundAt: null,
        emailNotifications: false,
        aiConsentAt: null,
        aiConsentDeclinedAt: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpRecoveryHashes: [],
        totpLastStep: null,
        status: "disabled",
        deletedAt: new Date(),
      })
      .where(eq(s.users.id, target.id));

    // The activity log records that it happened and who did it, without the personal details.
    await audit(tx, {
      actorId: actor.id === target.id ? null : actor.id,
      action: "account.deleted",
      entityType: "user",
      entityId: target.id,
      details: { by: actor.id === target.id ? "client" : "admin", erasedCases: summary.erasedCases, keptCases: summary.keptCases },
      ip: meta.ip ?? null,
    });
  });

  // Stored files: after the commit, best effort (a file left behind can't be reached: its record is gone).
  for (const key of files) {
    try {
      await storage().remove(key);
      summary.files++;
    } catch (err) {
      console.error("[account-deletion] couldn't remove a file", err instanceof Error ? err.message : err);
    }
  }

  // A last email to the address that was deleted, in their language.
  try {
    const locale = (target.locale as Locale) ?? "he";
    const d = dictionaries[locale];
    const { text, html } = renderEmail({
      locale,
      greeting: fmt(d.email.greeting, { name: target.name }),
      title: d.accountDeletion.emailTitle,
      body: summary.keptCases ? d.accountDeletion.emailBodyKept : d.accountDeletion.emailBody,
      footer: fmt(d.email.footer, { app: env.appName }),
    });
    await sendEmail({ to: target.email, subject: d.accountDeletion.emailTitle, text, html }, db);
  } catch (err) {
    console.error("[account-deletion] confirmation email failed", err instanceof Error ? err.message : err);
  }
  return summary;
}
