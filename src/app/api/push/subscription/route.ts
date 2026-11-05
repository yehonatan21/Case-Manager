import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { countPushDevices, removePushSubscription, savePushSubscription } from "@/lib/services/push";

const Sub = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Turn push on for this browser (the subscription comes from PushManager.subscribe()). */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  const body = await readJson(req, Sub);
  const db = await getDb();
  await savePushSubscription(db, user, body, req.headers.get("user-agent"));
  return ok({ devices: await countPushDevices(db, user.id) });
});

/** Turn push off for this browser. */
export const DELETE = route(async (req) => {
  const user = await requireApiUser();
  const { endpoint } = await readJson(req, z.object({ endpoint: z.string().max(2000) }));
  const db = await getDb();
  await removePushSubscription(db, user, endpoint);
  return ok({ devices: await countPushDevices(db, user.id) });
});
