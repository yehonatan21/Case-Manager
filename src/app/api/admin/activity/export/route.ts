import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { getDict } from "@/lib/i18n/server";
import { route } from "@/lib/api";
import { activityCsv } from "@/lib/services/activity";

/** Admin: the filtered activity log as a CSV file. */
export const GET = route(async (req) => {
  const user = await requireApiStaff();
  const sp = new URL(req.url).searchParams;
  const { d } = await getDict();
  const csv = await activityCsv(
    await getDb(),
    user,
    { q: sp.get("q") ?? undefined, actor: sp.get("actor") ?? undefined, group: sp.get("group") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined },
    (a) => d.activity.actions[a] ?? a,
  );
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="activity-${day}.csv"`, "cache-control": "no-store" } });
});
