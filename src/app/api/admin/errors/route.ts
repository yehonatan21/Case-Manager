import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { listErrors, resolveErrors } from "@/lib/services/error-tracking";

/** Admin: recorded errors (GET), mark some or all as fixed (POST). */
export const GET = route(async (req) => {
  const user = await requireApiStaff();
  return ok(await listErrors(await getDb(), user, { includeResolved: new URL(req.url).searchParams.get("all") === "1" }));
});

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const { ids } = await readJson(req, z.object({ ids: z.union([z.array(z.string()).max(100), z.literal("all")]) }));
  return ok({ resolved: await resolveErrors(await getDb(), user, ids) });
});
