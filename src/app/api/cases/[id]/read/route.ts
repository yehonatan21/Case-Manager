import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { caseWithAccess, markCaseRead } from "@/lib/services/cases";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiUser();
  const db = await getDb();
  await caseWithAccess(db, user, id);
  await markCaseRead(db, user, id);
  return ok();
});
