import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { clientIp, requireApiUser } from "@/lib/auth/session";
import { approveQuote } from "@/lib/services/quotes";
import { AppError } from "@/lib/errors";

/** Customer approval of a specific quote version (POST /quotes/:id/approve in the spec). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const { confirm } = await readJson(req, z.object({ confirm: z.literal(true) }).or(z.object({ confirm: z.boolean() })));
  if (!confirm) throw new AppError("validation");
  const q = await approveQuote(await getDb(), user, id, await clientIp());
  return ok({ id: q.id, status: q.status });
});
