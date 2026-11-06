import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteReplyTemplate, updateReplyTemplate } from "@/lib/services/conversations";

const Body = z.object({ title: z.string().trim().min(1).max(120), bodyHe: z.string().max(4000), bodyEn: z.string().max(4000) });

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  return ok(await updateReplyTemplate(await getDb(), user, id, await readJson(req, Body)));
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteReplyTemplate(await getDb(), user, id);
  return ok();
});
