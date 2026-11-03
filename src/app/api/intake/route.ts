import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createIntake } from "@/lib/services/intake";
import { clientIp, getCurrentUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { ensureOwnerToken } from "./_owner";
import { publicIntake } from "./_view";

/** Starts an intake (POST /cases/intake in the spec). Works without an account. */
export const POST = route(async (req) => {
  const body = await readJson(req, z.object({ message: z.string().max(4000).nullish(), mode: z.enum(["chat", "manual"]).default("chat") }));
  const ownerToken = await ensureOwnerToken();
  const session = await createIntake(await getDb(), {
    message: body.message ?? null,
    mode: body.mode,
    locale: await getLocale(),
    user: await getCurrentUser(),
    ownerToken,
    ip: await clientIp(),
  });
  return ok(publicIntake(session));
});
