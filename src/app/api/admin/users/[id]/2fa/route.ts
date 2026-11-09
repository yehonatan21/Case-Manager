import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { resetTwoFactor } from "@/lib/services/two-factor";

/** Admin: turn off a team member's two-step sign-in (a lost phone); they set it up again. */
export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const admin = await requireApiStaff();
  await resetTwoFactor(await getDb(), admin, id);
  return ok();
});
