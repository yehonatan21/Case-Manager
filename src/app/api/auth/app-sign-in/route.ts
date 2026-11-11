import { cookies } from "next/headers";
import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { GOOGLE_SIGNUP_COOKIE } from "@/lib/services/google";
import { redeemAppSignIn } from "@/lib/services/app-sign-in";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { isStaffRole } from "@/lib/domain";

/**
 * The iPhone/Android app finishing Google sign-in: the one-time code from the system browser plus the secret only
 * the app holds (see src/lib/services/app-sign-in.ts). Signs this web view in and says where to go.
 */
export const POST = route(async (req) => {
  const { code, verifier } = await readJson(req, z.object({ code: z.string().min(16).max(200), verifier: z.string().min(32).max(200) }));
  const db = await getDb();
  const grant = await redeemAppSignIn(db, code, verifier);
  if (grant.signupToken) {
    // A new Google account: finish registration (terms, customer type) in the app.
    (await cookies()).set(GOOGLE_SIGNUP_COOKIE, grant.signupToken, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: 1800 });
    return ok({ next: `/register?google=1${grant.next ? `&next=${encodeURIComponent(grant.next)}` : ""}` });
  }
  const [user] = grant.userId ? await db.select().from(users).where(eq(users.id, grant.userId)) : [];
  if (!user || user.status === "disabled") throw new AppError("forbidden");
  const home = grant.next ?? (isStaffRole(user.role) ? "/admin" : "/portal");
  if (grant.mfaPending) {
    await createSession(user.id, { mfaPending: true });
    return ok({ next: `/login/2fa?next=${encodeURIComponent(home)}` });
  }
  await createSession(user.id);
  return ok({ next: home });
});
