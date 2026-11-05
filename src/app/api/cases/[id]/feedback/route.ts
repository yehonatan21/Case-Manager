import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { submitFeedback } from "@/lib/services/feedback";

/** Client: rate a completed case (1–5, optional comment), once. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const body = await readJson(req, z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(2000).nullish() }));
  const f = await submitFeedback(await getDb(), user, id, body);
  return ok({ id: f.id });
});
