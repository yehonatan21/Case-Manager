import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { publishClientUpdate } from "@/lib/services/cases";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const { text } = await readJson(req, z.object({ text: z.string().min(1).max(2000) }));
  await publishClientUpdate(await getDb(), user, id, text);
  return ok();
});
