import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { applyTemplate, createTasks } from "@/lib/services/tasks";

const Task = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  assigneeId: z.uuid().nullish(),
  dueDate: z.iso.date().nullish(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  requiresClientAction: z.boolean().optional(),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ tasks: z.array(Task).max(30).optional(), templateId: z.uuid().optional(), aiRunId: z.uuid().nullish() }));
  const db = await getDb();
  const rows = body.templateId ? await applyTemplate(db, user, id, body.templateId) : await createTasks(db, user, id, body.tasks ?? [], { aiRunId: body.aiRunId });
  return ok({ count: rows.length });
});
