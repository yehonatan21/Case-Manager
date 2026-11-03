import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/services/notifications";

export const GET = route(async () => {
  const user = await requireApiUser();
  const db = await getDb();
  return ok({ items: await listNotifications(db, user, 20), unread: await unreadCount(db, user) });
});

export const POST = route(async (req) => {
  const user = await requireApiUser();
  const { ids } = await readJson(req, z.object({ ids: z.array(z.uuid()).max(100).optional() }));
  await markNotificationsRead(await getDb(), user, ids);
  return ok();
});
