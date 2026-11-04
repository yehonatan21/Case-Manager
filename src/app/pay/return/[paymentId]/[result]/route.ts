import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { portalCaseLink } from "@/lib/services/cases";

/**
 * Where Grow sends the customer after paying or cancelling (Grow doesn't accept query strings in these URLs).
 * Only redirects; the payment itself is confirmed by Grow's server update. The portal page checks access.
 */
export async function GET(req: Request, { params }: { params: Promise<{ paymentId: string; result: string }> }) {
  const { paymentId, result } = await params;
  const outcome = result === "success" ? "success" : "cancelled";
  let target = "/portal";
  if (/^[0-9a-f-]{36}$/i.test(paymentId)) {
    const [p] = await (await getDb()).select({ caseId: payments.caseId }).from(payments).where(eq(payments.id, paymentId));
    if (p) target = `${portalCaseLink(p.caseId)}?tab=quote&payment=${outcome}`;
  }
  return NextResponse.redirect(new URL(target, req.url), 303);
}
