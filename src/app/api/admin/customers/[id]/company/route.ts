import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { makeCompany } from "@/lib/services/companies";

/** Makes the client a company account, or renames the company. */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ name: z.string().trim().min(1).max(200), businessId: z.string().max(40).nullable().optional() }));
  return ok({ organizationId: await makeCompany(await getDb(), user, id, body) });
});
