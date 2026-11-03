import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser, requireApiStaff } from "@/lib/auth/session";
import { assignCase, getCaseBundle, updateCaseFields } from "@/lib/services/cases";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiUser();
  return ok(await getCaseBundle(await getDb(), user, id));
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      assigneeId: z.uuid().nullable().optional(),
      urgency: z.enum(["low", "normal", "high", "urgent"]).optional(),
      serviceCategory: z.string().max(60).optional(),
      title: z.string().max(200).optional(),
    }),
  );
  const db = await getDb();
  if (body.assigneeId !== undefined) await assignCase(db, user, id, body.assigneeId);
  if (body.urgency || body.serviceCategory || body.title) await updateCaseFields(db, user, id, body);
  return ok();
});
