import { eq } from "drizzle-orm";
import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { clientIp, requireApiStaff } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { customers } from "@/lib/db/schema";
import { deleteCustomerAccount } from "@/lib/services/account-deletion";

/** An admin deletes a client's account at the client's request (`id` is the client's customer id). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const actor = await requireApiStaff();
  if (actor.role !== "admin") throw new AppError("forbidden");
  const { confirm } = await readJson(req, z.object({ confirm: z.string().max(320) }));
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found");
  const db = await getDb();
  const [c] = await db.select({ userId: customers.userId }).from(customers).where(eq(customers.id, id));
  if (!c) throw new AppError("not_found");
  return ok(await deleteCustomerAccount(db, actor, c.userId, confirm, { ip: await clientIp() }));
});
