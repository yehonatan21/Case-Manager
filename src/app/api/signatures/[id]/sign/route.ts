import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { clientIp, requireApiUser } from "@/lib/auth/session";
import { signDocument } from "@/lib/services/signatures";

/** Client: sign a requested document (typed full name, optional drawn signature, consent). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const body = await readJson(req, z.object({ name: z.string().max(200), image: z.string().max(450_000).nullish(), consent: z.boolean() }));
  const sig = await signDocument(await getDb(), user, id, body, { ip: await clientIp(), userAgent: req.headers.get("user-agent") });
  return ok({ id: sig.id, signedAt: sig.signedAt });
});
