import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { inviteStaff } from "@/lib/services/users";

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ email: z.email(), name: z.string().min(1).max(120), role: z.enum(["admin", "case_manager", "staff", "finance"]) }));
  const u = await inviteStaff(await getDb(), user, body);
  return ok({ id: u.id });
});
