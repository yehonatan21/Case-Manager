import type { Database } from "../db";
import { expireQuotes } from "./quotes";
import { dispatchPendingEmails } from "./notifications";

/** Periodic maintenance: expire stale quotes and flush the email outbox. Run via cron (POST /api/jobs/run) or `npm run jobs:run`. */
export async function runJobs(db: Database) {
  const expired = await expireQuotes(db);
  const emails = await dispatchPendingEmails(db, 100);
  return { expiredQuotes: expired, emailsSent: emails };
}
