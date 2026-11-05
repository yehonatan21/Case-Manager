import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { connectInvoices, disconnectInvoices, getInvoiceStatus } from "@/lib/services/invoices";

const Key = z.string().trim().regex(/^[\w-]{8,200}$/);

/** Admin: the invoicing service connection (GET), connect — keys checked, then stored encrypted (PUT), disconnect (DELETE). */
export const GET = route(async () => {
  const user = await requireApiStaff();
  if (user.role !== "admin" && user.role !== "finance") throw new AppError("forbidden");
  return ok(await getInvoiceStatus(await getDb()));
});

export const PUT = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      provider: z.literal("greeninvoice"),
      apiKeyId: z.union([Key, z.literal("")]),
      apiSecret: z.union([Key, z.literal("")]),
      sandbox: z.boolean(),
      documentType: z.enum(["320", "400"]),
      autoIssue: z.boolean(),
      emailClient: z.boolean(),
    }),
  );
  const db = await getDb();
  await connectInvoices(db, user, body);
  return ok(await getInvoiceStatus(db));
});

export const DELETE = route(async () => {
  const user = await requireApiStaff();
  const db = await getDb();
  await disconnectInvoices(db, user);
  return ok(await getInvoiceStatus(db));
});
