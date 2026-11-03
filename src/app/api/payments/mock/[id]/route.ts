import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { completeMockPayment } from "@/lib/services/payments";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/** Outcome from the simulated hosted checkout page (mock provider only). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (env.paymentProvider !== "mock") throw new AppError("not_found");
  const user = await requireApiUser();
  const { outcome } = await readJson(req, z.object({ outcome: z.enum(["succeeded", "failed", "cancelled"]) }));
  const res = await completeMockPayment(await getDb(), user, id, outcome);
  return ok(res);
});
