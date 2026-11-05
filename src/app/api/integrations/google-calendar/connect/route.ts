import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaffRole } from "@/lib/domain";
import { googleEnabled, startGoogleSignIn } from "@/lib/services/google";

/** A team member connects their Google Calendar: Google's consent screen with calendar access. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isStaffRole(user.role)) return NextResponse.redirect(new URL("/login?next=/admin/meetings", env.appUrl));
  if (!googleEnabled()) return NextResponse.redirect(new URL("/admin/meetings?calendar=failed", env.appUrl));
  const { url, cookie, cookieName } = startGoogleSignIn("/admin/meetings", { calendarFor: user.id });
  const res = NextResponse.redirect(url);
  res.cookies.set(cookieName, cookie, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
