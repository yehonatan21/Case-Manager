import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { createCategory, listServiceCategories } from "@/lib/services/categories";

/** Service types (built-in and custom). Any staff member can list them; only admins add. */
export const GET = route(async () => {
  await requireApiStaff();
  return ok(await listServiceCategories(await getDb(), { includeInactive: true }));
});

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ nameHe: z.string().max(60), nameEn: z.string().max(60) }));
  const row = await createCategory(await getDb(), user, body);
  return ok({ key: row.key });
});
