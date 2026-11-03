import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteTask, updateTask } from "@/lib/services/tasks";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(4000).optional(),
      assigneeId: z.uuid().nullable().optional(),
      dueDate: z.iso.date().nullable().optional(),
      priority: z.enum(["low", "normal", "high"]).optional(),
      requiresClientAction: z.boolean().optional(),
      status: z.enum(["todo", "in_progress", "waiting", "done", "cancelled"]).optional(),
    }),
  );
  await updateTask(await getDb(), user, id, body);
  return ok();
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteTask(await getDb(), user, id);
  return ok();
});
