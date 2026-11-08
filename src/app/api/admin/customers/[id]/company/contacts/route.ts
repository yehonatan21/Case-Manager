import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { addCompanyContact } from "@/lib/services/companies";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      name: z.string().trim().min(1).max(120),
      email: z.email().max(200),
      phone: z.string().max(40).nullable().optional(),
      role: z.enum(["owner", "contact", "billing", "signatory"]),
      access: z.enum(["all", "own"]),
      locale: z.enum(["he", "en"]).optional(),
    }),
  );
  return ok({ userId: await addCompanyContact(await getDb(), user, id, body) });
});
