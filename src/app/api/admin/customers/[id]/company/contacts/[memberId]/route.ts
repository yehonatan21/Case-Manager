import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { removeCompanyContact, updateCompanyContact } from "@/lib/services/companies";

export const PATCH = route<{ id: string; memberId: string }>(async (req, { memberId }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ role: z.enum(["owner", "contact", "billing", "signatory"]), access: z.enum(["all", "own"]) }));
  await updateCompanyContact(await getDb(), user, memberId, body);
  return ok();
});

export const DELETE = route<{ id: string; memberId: string }>(async (_req, { memberId }) => {
  const user = await requireApiStaff();
  await removeCompanyContact(await getDb(), user, memberId);
  return ok();
});
