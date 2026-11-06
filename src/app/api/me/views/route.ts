import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { listSavedViews, saveView } from "@/lib/services/queue";

export const GET = route(async () => {
  const user = await requireApiStaff();
  return ok(await listSavedViews(await getDb(), user));
});

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ name: z.string().trim().min(1).max(60), query: z.string().max(1000) }));
  return ok(await saveView(await getDb(), user, body));
});
