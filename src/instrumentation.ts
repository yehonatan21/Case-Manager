/** Runs once when a server instance starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { env, assertProductionConfig } = await import("./lib/env");
  // Refuse to boot in production with insecure defaults.
  assertProductionConfig();

  // Optional in-process scheduler for single-instance hosting (no external cron needed).
  // Safe with several instances: the email outbox claims rows with SKIP LOCKED and quote expiry is idempotent.
  if (env.jobsIntervalMinutes > 0) {
    const { getDb } = await import("./lib/db");
    const { runJobs } = await import("./lib/services/jobs");
    const tick = async () => {
      try {
        const r = await runJobs(await getDb());
        if (r.expiredQuotes || r.emailsSent) console.log("[jobs]", r);
      } catch (err) {
        console.error("[jobs] failed", err);
      }
    };
    const timer = setInterval(tick, env.jobsIntervalMinutes * 60_000);
    timer.unref?.();
    // Warm up the database (migrations + seed) right away so the first request is fast.
    void getDb().catch((err) => console.error("[startup] database init failed", err));
  }
}
