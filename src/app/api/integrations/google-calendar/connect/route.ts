import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaffRole } from "@/lib/domain";
import { googleEnabled, startGoogleSignIn } from "@/lib/services/google";

/** A team member connects their Google Calendar: Google's consent screen with calendar access. */
export async function GET(req: Request) {
  // Where to come back to: the Meetings page by default, or e.g. Settings → Integrations.
  const asked = new URL(req.url).searchParams.get("next");
  const next = asked && /^\/admin\/[\w\-/?=&]*$/.test(asked) ? asked : "/admin/meetings";
  const user = await getCurrentUser();
  if (!user || !isStaffRole(user.role)) return NextResponse.redirect(new URL("/login?next=/admin/meetings", env.appUrl));
  if (!googleEnabled()) return NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}calendar=failed`, env.appUrl));
  const { url, cookie, cookieName } = startGoogleSignIn(next, { calendarFor: user.id });
  const res = NextResponse.redirect(url);
  res.cookies.set(cookieName, cookie, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
