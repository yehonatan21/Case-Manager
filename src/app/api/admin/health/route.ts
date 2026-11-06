import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { getSystemHealth } from "@/lib/services/health";

export const GET = route(async () => {
  const user = await requireApiStaff();
  return ok(await getSystemHealth(await getDb(), user));
});
