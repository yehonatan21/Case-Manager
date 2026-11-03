import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { handleWebhook } from "@/lib/services/payments";

export const POST = route(async (req) => {
  const raw = await req.text();
  const res = await handleWebhook(await getDb(), "stripe", raw, req.headers);
  return ok(res);
});
