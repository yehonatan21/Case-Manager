import { cookies } from "next/headers";
import { needsSecondStep } from "@/lib/services/two-factor";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { saveCalendarConnection } from "@/lib/services/calendar";
import { AppError } from "@/lib/errors";
import { isStaffRole } from "@/lib/domain";
import { GOOGLE_SIGNUP_COOKIE, GOOGLE_STATE_COOKIE, finishGoogleSignIn, googleAttemptApp, googleStateCookieName, resolveGoogleUser } from "@/lib/services/google";
import { createAppSignIn } from "@/lib/services/app-sign-in";

/** Started from the iPhone/Android app: back to the app (through /app-return), not into this browser. */
const toApp = (q: Record<string, string>) => NextResponse.redirect(new URL(`/app-return?${new URLSearchParams(q).toString()}`, env.appUrl));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const state = url.searchParams.get("state");
  const name = googleStateCookieName(state);
  // Falls back to the old shared cookie for attempts started before this change.
  const stateCookie = jar.get(name)?.value ?? jar.get(GOOGLE_STATE_COOKIE)?.value;
  const fromApp = googleAttemptApp(stateCookie);
  const fail = (code: string) => (fromApp ? toApp({ error: code }) : NextResponse.redirect(new URL(`/login?error=${code}`, env.appUrl)));
  if (url.searchParams.get("error")) return fail("google_cancelled");
  try {
    const { profile, next, calendar, app } = await finishGoogleSignIn({ code: url.searchParams.get("code"), state, cookie: stateCookie });
    jar.set(name, "", { path: "/api/auth/google", maxAge: 0 });
    jar.delete(GOOGLE_STATE_COOKIE);
    if (calendar) {
      // A team member connecting their Google Calendar (not a sign-in): must still be signed in as themselves.
      const me = await getCurrentUser();
      const target = next && next.startsWith("/admin/") ? next : "/admin/meetings";
      const back = (q: string) => NextResponse.redirect(new URL(`${target}${target.includes("?") ? "&" : "?"}calendar=${q}`, env.appUrl));
      if (!me || me.id !== calendar.userId) return back("wrong_user");
      try {
        await saveCalendarConnection(await getDb(), me, { refreshToken: calendar.refreshToken, email: profile.email, scopesGranted: calendar.scopesGranted });
      } catch (e) {
        return back(e instanceof AppError && e.code === "calendar_not_granted" ? "not_granted" : "failed");
      }
      return back("connected");
    }
    const db = await getDb();
    const res = await resolveGoogleUser(db, profile);
    if (app) {
      // The app's web view gets the session, not this system browser.
      if ("user" in res) {
        const home = next ?? (isStaffRole(res.user.role) ? "/admin" : "/portal");
        return toApp({ code: await createAppSignIn(db, app, { userId: res.user.id, mfaPending: needsSecondStep(res.user) }, home) });
      }
      return toApp({ code: await createAppSignIn(db, app, { signupToken: res.pendingToken }, next) });
    }
    if ("user" in res) {
      const home = next ?? (isStaffRole(res.user.role) ? "/admin" : "/portal");
      if (needsSecondStep(res.user)) {
        await createSession(res.user.id, { mfaPending: true });
        return NextResponse.redirect(new URL(`/login/2fa?next=${encodeURIComponent(home)}`, env.appUrl));
      }
      await createSession(res.user.id);
      return NextResponse.redirect(new URL(home, env.appUrl));
    }
    // New email: finish registration (terms, customer type) before the account is created.
    jar.set(GOOGLE_SIGNUP_COOKIE, res.pendingToken, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: 1800 });
    return NextResponse.redirect(new URL(`/register?google=1${next ? `&next=${encodeURIComponent(next)}` : ""}`, env.appUrl));
  } catch (err) {
    console.error("[google] sign-in failed", err instanceof Error ? err.message : err);
    const reason = err instanceof AppError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
    if (err instanceof AppError && err.code === "account_disabled") return fail("account_disabled");
    return fail(reason ? `google_${reason}` : "google_failed");
  }
}
