import type { Database } from "../db";
import { expireQuotes } from "./quotes";
import { dispatchPendingEmails } from "./notifications";
import { dispatchPendingPushes, prunePushOutbox } from "./push";
import { sendDocumentReminders } from "./checklists";

/**
 * Periodic maintenance: expire stale quotes, remind clients about missing documents, flush the email and push outboxes (retries), prune old push rows.
 * Run via cron (POST /api/jobs/run) or `npm run jobs:run`.
 */
export async function runJobs(db: Database) {
  const expired = await expireQuotes(db);
  const reminders = await sendDocumentReminders(db);
  const emails = await dispatchPendingEmails(db, 100);
  const pushes = await dispatchPendingPushes(db, 200);
  await prunePushOutbox(db);
  return { expiredQuotes: expired, documentReminders: reminders.cases, emailsSent: emails, pushesSent: pushes };
}
