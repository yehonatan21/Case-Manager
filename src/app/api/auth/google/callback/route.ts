import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { saveCalendarConnection } from "@/lib/services/calendar";
import { AppError } from "@/lib/errors";
import { isStaffRole } from "@/lib/domain";
import { GOOGLE_SIGNUP_COOKIE, GOOGLE_STATE_COOKIE, finishGoogleSignIn, googleStateCookieName, resolveGoogleUser } from "@/lib/services/google";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, env.appUrl));
  if (url.searchParams.get("error")) return fail("google_cancelled");
  try {
    const state = url.searchParams.get("state");
    const name = googleStateCookieName(state);
    // Falls back to the old shared cookie for attempts started before this change.
    const { profile, next, calendar } = await finishGoogleSignIn({ code: url.searchParams.get("code"), state, cookie: jar.get(name)?.value ?? jar.get(GOOGLE_STATE_COOKIE)?.value });
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
    const res = await resolveGoogleUser(await getDb(), profile);
    if ("user" in res) {
      await createSession(res.user.id);
      return NextResponse.redirect(new URL(next ?? (isStaffRole(res.user.role) ? "/admin" : "/portal"), env.appUrl));
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
