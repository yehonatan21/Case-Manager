import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users, type User } from "../db/schema";
import { randomToken, sha256 } from "../crypto";
import { env } from "../env";
import { AppError } from "../errors";
import { isStaffRole } from "../domain";

export const SESSION_COOKIE = "cm_session";
const SESSION_DAYS = 30;

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.user ?? null;
  if (!user || user.status === "disabled") return null;
  return user;
});

export async function createSession(userId: string) {
  const db = await getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt, userAgent: ua });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** For pages: redirect to sign-in when there's no session. */
export async function requirePageUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

export async function requirePageStaff(nextPath: string): Promise<User> {
  const user = await requirePageUser(nextPath);
  if (!isStaffRole(user.role)) redirect("/portal");
  return user;
}

export async function requirePageCustomer(nextPath: string): Promise<User> {
  const user = await requirePageUser(nextPath);
  if (isStaffRole(user.role)) redirect("/admin");
  return user;
}

/** For API routes: throw a 401/403 AppError. */
export async function requireApiUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthorized");
  return user;
}

export async function requireApiStaff(): Promise<User> {
  const user = await requireApiUser();
  if (!isStaffRole(user.role)) throw new AppError("forbidden");
  return user;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}
