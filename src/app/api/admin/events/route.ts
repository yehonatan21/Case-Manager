import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { createStaffEvent } from "@/lib/services/staff-events";
import { EventBody } from "./_schema";

/** Staff: add an event to their own calendar (and to Google Calendar when connected). */
export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, EventBody);
  const e = await createStaffEvent(await getDb(), user, body);
  return ok({ id: e.id, google: !!e.externalEventId, meetUrl: e.meetUrl });
});
