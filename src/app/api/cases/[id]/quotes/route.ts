import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { createDraftQuote } from "@/lib/services/quotes";

/** Create (or reopen) the draft quote for a case (POST /cases/:id/quotes in the spec). */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  const q = await createDraftQuote(await getDb(), user, id);
  return ok({ id: q.id });
});
