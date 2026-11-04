import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { growCallbackFromForm, parseGrowCallback } from "@/lib/payments/grow";
import { handleGrowCallback } from "@/lib/services/payments";

/**
 * Grow server-to-server update for one payment (the notifyUrl we passed to createPaymentProcess).
 * The token in the path is an HMAC of the payment id; the transaction is re-checked with Grow before it counts.
 */
export const POST = route<{ paymentId: string; token: string }>(async (req, { paymentId, token }) => {
  const ct = req.headers.get("content-type");
  const fields = ct?.toLowerCase().includes("multipart/form-data") ? growCallbackFromForm(await req.formData()) : parseGrowCallback(await req.text(), ct);
  const res = await handleGrowCallback(await getDb(), paymentId, token, fields);
  return ok(res);
});

/** Room for the getTransactionInfo and approveTransaction calls to Grow. */
export const maxDuration = 30;
