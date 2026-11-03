import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { INTAKE_OWNER_COOKIE } from "@/lib/services/intake";

export async function readOwnerToken(): Promise<string | null> {
  return (await cookies()).get(INTAKE_OWNER_COOKIE)?.value ?? null;
}

/** Anonymous visitors own their intake conversations through an httpOnly browser token. */
export async function ensureOwnerToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(INTAKE_OWNER_COOKIE)?.value;
  if (existing) return existing;
  const token = randomToken();
  jar.set(INTAKE_OWNER_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return token;
}
