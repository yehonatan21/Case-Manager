import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { setHourlyCost } from "@/lib/services/time";

/** A team member's cost per hour (admins only). */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const { cents } = await readJson(req, z.object({ cents: z.number().int().min(0).max(10_000_000).nullable() }));
  await setHourlyCost(await getDb(), user, id, cents);
  return ok();
});
