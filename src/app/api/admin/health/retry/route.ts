import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { retryFailed } from "@/lib/services/health";

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const { kind } = await readJson(req, z.object({ kind: z.enum(["email", "whatsapp", "push", "invoices"]) }));
  return ok(await retryFailed(await getDb(), user, kind));
});
