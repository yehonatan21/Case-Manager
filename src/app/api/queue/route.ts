import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { listQueue, queueCounts } from "@/lib/services/queue";

export const GET = route(async (req) => {
  const user = await requireApiStaff();
  const q = new URL(req.url).searchParams;
  const db = await getDb();
  const list = await listQueue(db, user, {
    view: q.get("view") ?? undefined,
    q: q.get("q") ?? undefined,
    category: q.get("category") ?? undefined,
    assignee: q.get("assignee") ?? undefined,
    urgency: q.get("urgency") ?? undefined,
    page: Number(q.get("page")) || 1,
  });
  return ok({ ...list, counts: await queueCounts(db, user) });
});
