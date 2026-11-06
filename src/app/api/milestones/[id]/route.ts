import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteMilestone, setMilestoneDone } from "@/lib/services/tasks";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const { done } = await readJson(req, z.object({ done: z.boolean() }));
  return ok(await setMilestoneDone(await getDb(), user, id, done));
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteMilestone(await getDb(), user, id);
  return ok();
});
