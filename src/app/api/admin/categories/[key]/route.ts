import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { updateCategory } from "@/lib/services/categories";

/** Admin: rename or hide/show a custom service type. */
export const PATCH = route<{ key: string }>(async (req, { key }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ nameHe: z.string().max(60).optional(), nameEn: z.string().max(60).optional(), active: z.boolean().optional() }));
  const row = await updateCategory(await getDb(), user, key, body);
  return ok({ key: row.key, active: row.active });
});
