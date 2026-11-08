import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteStaffEvent, updateStaffEvent } from "@/lib/services/staff-events";
import { EventBody } from "../_schema";

/** Staff: change or delete one of their own events (Google Calendar follows). */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, EventBody);
  const e = await updateStaffEvent(await getDb(), user, id, body);
  return ok({ id: e.id, google: !!e.externalEventId, meetUrl: e.meetUrl });
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteStaffEvent(await getDb(), user, id);
  return ok();
});
