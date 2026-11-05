import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { disconnectCalendar, getCalendarStatus } from "@/lib/services/calendar";

export const GET = route(async () => {
  const user = await requireApiStaff();
  return ok(await getCalendarStatus(await getDb(), user.id));
});

/** Disconnect the signed-in team member's Google Calendar. */
export const DELETE = route(async () => {
  const user = await requireApiStaff();
  await disconnectCalendar(await getDb(), user);
  return ok();
});
