import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { reviewDocument } from "@/lib/services/documents";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ status: z.enum(["in_review", "approved", "needs_new_version"]), note: z.string().max(2000).nullish() }));
  await reviewDocument(await getDb(), user, id, body);
  return ok();
});
