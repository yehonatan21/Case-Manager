import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { dispatchPendingPushes, queueTestPush } from "@/lib/services/push";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { rateLimit } from "@/lib/services/rate-limit";

/** Sends a test notification to all of the signed-in user's devices. */
export const POST = route(async () => {
  const user = await requireApiUser();
  const db = await getDb();
  await rateLimit(db, `push-test:${user.id}`, 5, 10 * 60);
  const d = dictionaries[user.locale === "en" ? "en" : "he"].push;
  await queueTestPush(db, user, { title: d.testTitle, body: d.testBody });
  const sent = await dispatchPendingPushes(db);
  return ok({ sent });
});
