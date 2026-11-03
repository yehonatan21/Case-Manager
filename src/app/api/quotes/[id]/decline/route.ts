import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { declineQuote } from "@/lib/services/quotes";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const { reason } = await readJson(req, z.object({ reason: z.string().max(2000).nullish() }));
  await declineQuote(await getDb(), user, id, reason ?? null);
  return ok();
});
