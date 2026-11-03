import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { handleWebhook } from "@/lib/services/payments";

/** Signed webhook from the payment provider (POST /webhooks/payments in the spec). Idempotent. */
export const POST = route(async (req) => {
  const raw = await req.text();
  const res = await handleWebhook(await getDb(), "mock", raw, req.headers);
  return ok(res);
});
