import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { caseStatusEnum } from "@/lib/db/schema";
import { bulkUpdateCases } from "@/lib/services/queue";

/** One change (assignee, urgency, deadline or status) applied to many cases. */
export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const { ids, action } = await readJson(
    req,
    z.object({
      ids: z.array(z.uuid()).min(1).max(100),
      action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("assign"), assigneeId: z.uuid().nullable() }),
        z.object({ type: z.literal("urgency"), urgency: z.enum(["low", "normal", "high", "urgent"]) }),
        z.object({ type: z.literal("due_date"), dueDate: z.iso.date().nullable() }),
        z.object({ type: z.literal("status"), status: z.enum(caseStatusEnum.enumValues) }),
      ]),
    }),
  );
  return ok(await bulkUpdateCases(await getDb(), user, ids, action));
});
