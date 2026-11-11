/**
 * Google sign-in from the iPhone/Android app.
 *
 * Google refuses sign-in inside an app's embedded web view, so the app opens it in the system browser
 * (Safari view / Chrome Custom Tab), whose cookies are separate from the app's. The flow:
 *
 *  1. The app makes a random secret, keeps it, and opens /api/auth/google?app=<SHA-256 of the secret>.
 *  2. Google sign-in runs in the system browser as usual; the callback, seeing `app`, doesn't sign the browser
 *     in. It stores a one-time code (5 minutes) bound to that hash and sends the browser to /app-return, which
 *     opens <scheme>://auth?code=… — back into the app.
 *  3. The app posts the code and its secret to /api/auth/app-sign-in, which signs the app's web view in.
 *
 * Another app that registers the same URL scheme could catch the code, but can't redeem it without the secret
 * (the same idea as PKCE). Codes are single-use.
 */
import crypto from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { appSignIns } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { randomToken, safeEqual, sha256 } from "../crypto";

const TTL_MS = 5 * 60_000;

/** base64url SHA-256: 43 characters. */
export function isValidAppChallenge(c: string | null | undefined): c is string {
  return !!c && /^[A-Za-z0-9_-]{43}$/.test(c);
}

export function appChallengeFor(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null);

export type AppSignInGrant = { userId: string; mfaPending: boolean } | { signupToken: string };

/** Step 2: a one-time code for the app. */
export async function createAppSignIn(db: DbOrTx, challenge: string, grant: AppSignInGrant, next: string | null): Promise<string> {
  if (!isValidAppChallenge(challenge)) throw new AppError("validation", "Invalid app challenge");
  const code = randomToken(32);
  await db.insert(appSignIns).values({
    codeHash: sha256(code),
    challenge,
    userId: "userId" in grant ? grant.userId : null,
    mfaPending: "userId" in grant ? grant.mfaPending : false,
    signupToken: "signupToken" in grant ? grant.signupToken : null,
    next: safeNext(next),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  // Old rows aren't needed once expired.
  await db.delete(appSignIns).where(lt(appSignIns.expiresAt, new Date(Date.now() - 24 * 3600_000)));
  return code;
}

/** Step 3: exchanges the code and the app's secret. Single use: a wrong secret also uses the code up. */
export async function redeemAppSignIn(db: DbOrTx, code: string, verifier: string) {
  if (!code || !verifier || verifier.length < 32 || verifier.length > 200) throw new AppError("forbidden", "Invalid sign-in code");
  const [row] = await db
    .update(appSignIns)
    .set({ usedAt: new Date() })
    .where(and(eq(appSignIns.codeHash, sha256(code)), isNull(appSignIns.usedAt), gt(appSignIns.expiresAt, new Date())))
    .returning();
  if (!row || !safeEqual(appChallengeFor(verifier), row.challenge)) throw new AppError("forbidden", "Invalid sign-in code");
  return { userId: row.userId, mfaPending: row.mfaPending, signupToken: row.signupToken, next: row.next };
}

/** Where the system browser sends the person back into the app. */
export function appReturnLink(params: { code: string } | { error: string }): string {
  const q = new URLSearchParams("code" in params ? { code: params.code } : { error: params.error });
  return `${env.appUrlScheme}://auth?${q.toString()}`;
}
