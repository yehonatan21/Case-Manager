import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getIntake, postIntakeMessage } from "@/lib/services/intake";
import { getCurrentUser } from "@/lib/auth/session";
import { readOwnerToken } from "../../_owner";
import { publicIntake } from "../../_view";

/** Next intake turn (POST /ai/intake/next in the spec). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, z.object({ content: z.string().min(1).max(4000), skipped: z.boolean().optional(), attachmentIds: z.array(z.uuid()).max(10).optional() }));
  const db = await getDb();
  const s = await getIntake(db, id, await getCurrentUser(), await readOwnerToken());
  return ok(publicIntake(await postIntakeMessage(db, s, body)));
});
