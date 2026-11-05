import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { cancelSignature } from "@/lib/services/signatures";

/** Staff: withdraw a signature request that hasn't been signed. */
export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiUser();
  await cancelSignature(await getDb(), user, id);
  return ok();
});
