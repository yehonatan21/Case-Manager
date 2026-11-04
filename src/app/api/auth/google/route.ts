import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { GOOGLE_STATE_COOKIE, googleEnabled, startGoogleSignIn } from "@/lib/services/google";

/** Redirects to Google's consent screen. ?next=/path returns there afterwards. */
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login", env.appUrl));
  const { url, cookie } = startGoogleSignIn(new URL(req.url).searchParams.get("next"));
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_STATE_COOKIE, cookie, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
