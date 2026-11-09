import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { clientIp, getCurrentUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/services/rate-limit";
import { recordError } from "@/lib/services/error-tracking";

/** A browser reports an error it hit (sent by the page itself; limited per address). */
export const POST = route(async (req) => {
  const body = await readJson(req, z.object({ message: z.string().min(1).max(2000), stack: z.string().max(8000).nullish(), path: z.string().max(500).nullish() }));
  const db = await getDb();
  const ip = await clientIp();
  await rateLimit(db, `errors:${ip ?? "unknown"}`, 30, 15 * 60);
  const user = await getCurrentUser();
  await recordError(db, { source: "browser", message: body.message, stack: body.stack, path: body.path, userId: user?.id ?? null });
  return ok();
});
