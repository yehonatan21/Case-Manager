import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { updateStaffUser } from "@/lib/services/users";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ role: z.enum(["admin", "case_manager", "staff", "finance"]).optional(), status: z.enum(["active", "disabled"]).optional() }));
  await updateStaffUser(await getDb(), user, id, body);
  return ok();
});
