import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { createCheckout } from "@/lib/services/payments";

export const POST = route(async (req) => {
  const user = await requireApiUser();
  const { quoteId } = await readJson(req, z.object({ quoteId: z.uuid() }));
  return ok(await createCheckout(await getDb(), user, quoteId));
});
