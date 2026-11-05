import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { issueInvoiceManually } from "@/lib/services/invoices";

/** Admin / finance: issue the document for a payment now, or retry a failed one. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  const inv = await issueInvoiceManually(await getDb(), user, id);
  return ok({ status: inv.status, number: inv.number, error: inv.error });
});
