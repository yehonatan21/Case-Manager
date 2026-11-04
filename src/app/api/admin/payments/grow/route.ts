import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { connectGrow, disconnectGrow, getPaymentProviderStatus } from "@/lib/services/payment-settings";

const Id = z.string().trim().regex(/^[A-Za-z0-9]{4,64}$/);

/** Admin: connect Grow (identifiers are stored encrypted) — PUT; disconnect — DELETE. */
export const PUT = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ userId: Id, pageCode: Id, apiKey: z.union([Id, z.literal("")]).nullish(), sandbox: z.boolean() }));
  const db = await getDb();
  await connectGrow(db, user, body);
  return ok(await getPaymentProviderStatus(db));
});

export const DELETE = route(async () => {
  const user = await requireApiStaff();
  const db = await getDb();
  await disconnectGrow(db, user);
  return ok(await getPaymentProviderStatus(db));
});
