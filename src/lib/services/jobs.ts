import type { Database } from "../db";
import { expireQuotes } from "./quotes";
import { dispatchPendingEmails } from "./notifications";
import { dispatchPendingPushes, prunePushOutbox } from "./push";

/**
 * Periodic maintenance: expire stale quotes, flush the email and push outboxes (retries), prune old push rows.
 * Run via cron (POST /api/jobs/run) or `npm run jobs:run`.
 */
export async function runJobs(db: Database) {
  const expired = await expireQuotes(db);
  const emails = await dispatchPendingEmails(db, 100);
  const pushes = await dispatchPendingPushes(db, 200);
  await prunePushOutbox(db);
  return { expiredQuotes: expired, emailsSent: emails, pushesSent: pushes };
}
