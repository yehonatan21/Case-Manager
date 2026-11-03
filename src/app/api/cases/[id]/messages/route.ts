import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { postMessage } from "@/lib/services/messages";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const body = await readJson(
    req,
    z.object({
      body: z.string().min(1).max(10000),
      kind: z.enum(["thread", "internal_note"]).default("thread"),
      isInfoRequest: z.boolean().optional(),
      aiRunId: z.uuid().nullish(),
    }),
  );
  const m = await postMessage(await getDb(), user, id, body);
  return ok({ id: m.id });
});
