import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { getAvailability, setAvailability } from "@/lib/services/meetings";

/** A team member's own meeting hours. */
export const GET = route(async () => {
  const user = await requireApiStaff();
  return ok(await getAvailability(await getDb(), user.id));
});

export const PUT = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ bookable: z.boolean(), weekly: z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() }))) }));
  await setAvailability(await getDb(), user, user.id, body);
  return ok(await getAvailability(await getDb(), user.id));
});
