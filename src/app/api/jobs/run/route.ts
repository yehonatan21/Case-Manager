import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { runJobs } from "@/lib/services/jobs";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { safeEqual } from "@/lib/crypto";

/** Cron entry point: `Authorization: Bearer $CRON_SECRET`. */
export const POST = route(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) throw new AppError("unauthorized");
  return ok(await runJobs(await getDb()));
});
