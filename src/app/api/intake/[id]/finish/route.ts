import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { finishIntake, getIntake } from "@/lib/services/intake";
import { getCurrentUser } from "@/lib/auth/session";
import { readOwnerToken } from "../../_owner";
import { publicIntake } from "../../_view";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const db = await getDb();
  const s = await getIntake(db, id, await getCurrentUser(), await readOwnerToken());
  return ok(publicIntake(await finishIntake(db, s)));
});

/** AI calls can take a while; allow up to a minute on serverless hosts. */
export const maxDuration = 60;
