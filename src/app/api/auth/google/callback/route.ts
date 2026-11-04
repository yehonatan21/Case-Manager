import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { isStaffRole } from "@/lib/domain";
import { GOOGLE_SIGNUP_COOKIE, GOOGLE_STATE_COOKIE, finishGoogleSignIn, resolveGoogleUser } from "@/lib/services/google";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, env.appUrl));
  if (url.searchParams.get("error")) return fail("google_cancelled");
  try {
    const { profile, next } = await finishGoogleSignIn({ code: url.searchParams.get("code"), state: url.searchParams.get("state"), cookie: jar.get(GOOGLE_STATE_COOKIE)?.value });
    jar.delete(GOOGLE_STATE_COOKIE);
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
