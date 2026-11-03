import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { sendQuote } from "@/lib/services/quotes";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  const q = await sendQuote(await getDb(), user, id);
  return ok({ id: q.id, status: q.status });
});
