import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteSavedView } from "@/lib/services/queue";

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteSavedView(await getDb(), user, id);
  return ok();
});
