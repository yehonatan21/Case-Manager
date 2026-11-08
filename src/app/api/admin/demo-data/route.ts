import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/services/audit";
import { removeDemoData } from "@/lib/services/demo-cleanup";

/** What removing the demo data would remove (admins). */
export const GET = route(async () => {
  const user = await requireApiStaff();
  if (user.role !== "admin") throw new AppError("forbidden");
  return ok(await removeDemoData(await getDb(), { apply: false }));
});

/** Removes the demo accounts and their sample requests (admins; not while DEMO_MODE is on). */
export const POST = route(async () => {
  const user = await requireApiStaff();
  if (user.role !== "admin") throw new AppError("forbidden");
  if (env.demoMode) throw new AppError("validation", "turn DEMO_MODE off first");
  const db = await getDb();
  const r = await removeDemoData(db, { apply: true });
  await audit(db, { actorId: user.id, action: "demo.remove", entityType: "settings", details: { users: r.users.length, cases: r.cases } });
  return ok(r);
});
