import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteTime, updateTime } from "@/lib/services/time";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ minutes: z.number().int().min(1).max(1440), date: z.iso.date(), note: z.string().max(500).optional(), billable: z.boolean().optional() }));
  return ok(await updateTime(await getDb(), user, id, body));
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteTime(await getDb(), user, id);
  return ok();
});
