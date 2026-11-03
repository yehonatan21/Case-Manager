import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { changeStatus } from "@/lib/services/cases";
import { caseStatusEnum } from "@/lib/db/schema";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const { status } = await readJson(req, z.object({ status: z.enum(caseStatusEnum.enumValues) }));
  const c = await changeStatus(await getDb(), user, id, status);
  return ok({ status: c.status });
});
