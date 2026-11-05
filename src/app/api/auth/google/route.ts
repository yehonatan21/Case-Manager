import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { googleEnabled, startGoogleSignIn } from "@/lib/services/google";

/** Redirects to Google's consent screen. ?next=/path returns there afterwards. */
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login", env.appUrl));
  const { url, cookie, cookieName } = startGoogleSignIn(new URL(req.url).searchParams.get("next"));
  const res = NextResponse.redirect(url);
  // Scoped to the callback, and named after this attempt's state, so attempts in other tabs don't replace it.
  res.cookies.set(cookieName, cookie, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
