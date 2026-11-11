import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { googleEnabled, startGoogleSignIn } from "@/lib/services/google";
import { isValidAppChallenge } from "@/lib/services/app-sign-in";

/**
 * Redirects to Google's consent screen. ?next=/path returns there afterwards.
 * ?app=<challenge>: started from the iPhone/Android app in the system browser (see app-sign-in.ts).
 */
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login", env.appUrl));
  const sp = new URL(req.url).searchParams;
  const app = sp.get("app");
  const { url, cookie, cookieName } = startGoogleSignIn(sp.get("next"), isValidAppChallenge(app) ? { app } : {});
  const res = NextResponse.redirect(url);
  // Scoped to the callback, and named after this attempt's state, so attempts in other tabs don't replace it.
  res.cookies.set(cookieName, cookie, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
