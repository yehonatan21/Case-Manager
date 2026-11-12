import { cookies } from "next/headers";
import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, clientIp, requireApiUser } from "@/lib/auth/session";
import { deleteCustomerAccount } from "@/lib/services/account-deletion";

/** A client deletes their own account (Profile → Delete account, or /delete-account). */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  const { confirm } = await readJson(req, z.object({ confirm: z.string().max(320) }));
  const summary = await deleteCustomerAccount(await getDb(), user, user.id, confirm, { ip: await clientIp() });
  (await cookies()).delete(SESSION_COOKIE); // the sessions themselves are already gone
  return ok({ ...summary, next: "/delete-account?done=1" });
});
