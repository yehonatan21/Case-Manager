import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { addTime, caseTimeSummary, startTimer, stopTimer } from "@/lib/services/time";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  return ok(await caseTimeSummary(await getDb(), user, id));
});

/** Start or stop the timer, or add time by hand. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("start") }),
      z.object({ action: z.literal("stop"), note: z.string().max(500).optional() }),
      z.object({ action: z.literal("add"), minutes: z.number().int().min(1).max(1440), date: z.iso.date(), note: z.string().max(500).optional(), billable: z.boolean().optional() }),
    ]),
  );
  const db = await getDb();
  if (body.action === "start") return ok(await startTimer(db, user, id));
  if (body.action === "stop") return ok(await stopTimer(db, user, id, body.note));
  return ok(await addTime(db, user, id, body));
});
