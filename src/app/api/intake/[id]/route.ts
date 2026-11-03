import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getIntake } from "@/lib/services/intake";
import { getCurrentUser } from "@/lib/auth/session";
import { readOwnerToken } from "../_owner";
import { publicIntake } from "../_view";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const s = await getIntake(await getDb(), id, await getCurrentUser(), await readOwnerToken());
  return ok(publicIntake(s));
});
