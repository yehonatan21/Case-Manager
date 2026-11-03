import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { requestQuoteClarification } from "@/lib/services/quotes";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const { text } = await readJson(req, z.object({ text: z.string().min(1).max(4000) }));
  await requestQuoteClarification(await getDb(), user, id, text);
  return ok();
});
