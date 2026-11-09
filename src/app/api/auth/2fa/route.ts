import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { clientIp, completeSecondStep, getPendingSecondStepUser } from "@/lib/auth/session";
import { checkSecondStep } from "@/lib/services/two-factor";
import { audit } from "@/lib/services/audit";

/** The second step of a staff sign-in: a code from the authenticator app, or a recovery code. */
export const POST = route(async (req) => {
  const { code } = await readJson(req, z.object({ code: z.string().trim().min(6).max(20) }));
  const user = await getPendingSecondStepUser();
  if (!user) throw new AppError("unauthorized");
  const db = await getDb();
  const how = await checkSecondStep(db, user, code);
  await completeSecondStep();
  await audit(db, { actorId: user.id, action: "auth.2fa_passed", entityType: "user", entityId: user.id, details: { how }, ip: await clientIp() });
  return ok({ home: "/admin", recoveryLeft: how === "recovery" ? user.totpRecoveryHashes.length - 1 : null });
});
