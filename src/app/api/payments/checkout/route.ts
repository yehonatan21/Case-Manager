import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { createCheckout } from "@/lib/services/payments";

export const POST = route(async (req) => {
  const user = await requireApiUser();
  const { quoteId, payer } = await readJson(
    req,
    z.object({
      quoteId: z.uuid(),
      // Required when Grow is the payment provider (checked in the service).
      payer: z.object({ fullName: z.string().max(100), phone: z.string().max(30), acceptTerms: z.boolean() }).optional(),
    }),
  );
  return ok(await createCheckout(await getDb(), user, quoteId, payer));
});
