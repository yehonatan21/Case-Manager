import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { availableSlots } from "@/lib/services/meetings";

/** Free times for a meeting of ?duration= minutes (?except=<meeting id> when moving one). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const q = new URL(req.url).searchParams;
  const duration = Number(q.get("duration"));
  if (!Number.isInteger(duration)) throw new AppError("validation");
  const except = q.get("except");
  return ok(await availableSlots(await getDb(), user, id, duration, { exceptMeetingId: except && /^[0-9a-f-]{36}$/i.test(except) ? except : undefined }));
});
