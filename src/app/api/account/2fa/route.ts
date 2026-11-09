import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { clientIp, requireApiStaff } from "@/lib/auth/session";
import { confirmTwoFactorSetup, disableTwoFactor, getTwoFactorStatus, startTwoFactorSetup } from "@/lib/services/two-factor";

const Code = z.object({ code: z.string().trim().min(6).max(20) });

/** A team member's two-step sign-in: status (GET), start setup — the QR code (POST), confirm with the first code (PUT), turn off (DELETE). */
export const GET = route(async () => {
  const user = await requireApiStaff({ allowWithoutSecondStep: true });
  return ok(await getTwoFactorStatus(await getDb(), user));
});

export const POST = route(async () => {
  const user = await requireApiStaff({ allowWithoutSecondStep: true });
  const { secret, qrSvg } = await startTwoFactorSetup(await getDb(), user);
  return ok({ secret, qrSvg });
});

export const PUT = route(async (req) => {
  const user = await requireApiStaff({ allowWithoutSecondStep: true });
  const { code } = await readJson(req, Code);
  const recoveryCodes = await confirmTwoFactorSetup(await getDb(), user, code, await clientIp());
  return ok({ recoveryCodes });
});

export const DELETE = route(async (req) => {
  const user = await requireApiStaff({ allowWithoutSecondStep: true });
  const { code } = await readJson(req, Code);
  await disableTwoFactor(await getDb(), user, code, await clientIp());
  return ok();
});
