import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { createCaseForCustomer } from "@/lib/services/cases";

const NewCustomer = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).nullish(),
  customerType: z.enum(["private", "business", "company", "other"]),
  organizationName: z.string().max(200).nullish(),
  locale: z.enum(["he", "en"]),
});

/** A case manager or admin opens a case on behalf of a client (existing or new). */
export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      customer: z.union([z.object({ id: z.uuid() }), NewCustomer]),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().min(1).max(8000),
      goal: z.string().max(2000).optional(),
      serviceCategory: z.string().max(60),
      urgency: z.enum(["low", "normal", "high", "urgent"]),
      assignToMe: z.boolean().default(true),
    }),
  );
  const r = await createCaseForCustomer(await getDb(), user, body);
  return ok({
    id: r.case.id,
    number: r.case.number,
    customerCreated: r.customerCreated,
  });
});
