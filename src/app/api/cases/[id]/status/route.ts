import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { changeStatus } from "@/lib/services/cases";
import { caseStatusEnum } from "@/lib/db/schema";
import { ACTIVATION_REASONS } from "@/lib/domain";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const { status, activation } = await readJson(
    req,
    z.object({
      status: z.enum(caseStatusEnum.enumValues),
      activation: z.object({ reason: z.enum(ACTIVATION_REASONS), note: z.string().max(500).optional() }).optional(),
    }),
  );
  const c = await changeStatus(await getDb(), user, id, status, { activation });
  return ok({ status: c.status });
});
