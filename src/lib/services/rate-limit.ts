import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { rateLimits } from "../db/schema";
import { AppError } from "../errors";

/**
 * Fixed-window rate limiter stored in the database (works across instances).
 * Throws `rate_limited` when the limit is exceeded.
 */
export async function rateLimit(db: DbOrTx, key: string, limit: number, windowSeconds: number) {
  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: new Date() })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  if ((rows[0]?.count ?? 0) > limit) throw new AppError("rate_limited");
}
