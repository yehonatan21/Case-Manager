import type { Database } from "../db";
import { expireQuotes, sendQuoteFollowups } from "./quotes";
import { dispatchPendingEmails } from "./notifications";
import { dispatchPendingPushes, prunePushOutbox } from "./push";
import { sendDocumentReminders } from "./checklists";
import { dispatchPendingWhatsApp } from "./whatsapp";
import { sendMeetingReminders } from "./meetings";
import { dispatchPendingInvoices } from "./invoices";
import { recordJobsRun } from "./health";
import { sendDeadlineReminders } from "./queue";

/**
 * Periodic maintenance: expire stale quotes, remind clients about missing documents, flush the email, push and WhatsApp outboxes (retries), prune old push rows.
 * Run via cron (POST /api/jobs/run) or `npm run jobs:run`.
 */
export async function runJobs(db: Database) {
  const expired = await expireQuotes(db);
  const reminders = await sendDocumentReminders(db);
  const meetingReminders = await sendMeetingReminders(db);
  const deadlineReminders = await sendDeadlineReminders(db);
  const quoteFollowups = await sendQuoteFollowups(db);
  const emails = await dispatchPendingEmails(db, 100);
  const pushes = await dispatchPendingPushes(db, 200);
  const whatsapp = await dispatchPendingWhatsApp(db, 200);
  const invoicesIssued = await dispatchPendingInvoices(db, 50);
  await prunePushOutbox(db);
  const result = { expiredQuotes: expired, documentReminders: reminders.cases, meetingReminders, deadlineReminders, quoteFollowups: quoteFollowups.client + quoteFollowups.staff, emailsSent: emails, pushesSent: pushes, whatsappSent: whatsapp, invoicesIssued };
  await recordJobsRun(db, result);
  return result;
}
