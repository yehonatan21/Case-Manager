import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { regenerateRecoveryCodes } from "@/lib/services/two-factor";

/** New recovery codes (the old ones stop working); needs a current code from the app. */
export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const { code } = await readJson(req, z.object({ code: z.string().trim().min(6).max(20) }));
  return ok({ recoveryCodes: await regenerateRecoveryCodes(await getDb(), user, code) });
});
