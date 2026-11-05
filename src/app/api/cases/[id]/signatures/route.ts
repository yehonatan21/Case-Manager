import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { requestSignature } from "@/lib/services/signatures";

/** Staff: ask the client to sign a PDF document of the case. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const body = await readJson(req, z.object({ documentId: z.uuid(), note: z.string().max(1000).nullish() }));
  const sig = await requestSignature(await getDb(), user, id, body.documentId, body.note);
  return ok({ id: sig.id });
});
