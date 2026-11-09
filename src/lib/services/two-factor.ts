/**
 * Two-step sign-in for staff: after the email code (or Google), a code from an authenticator app. A team member
 * turns it on under My account; an admin can require it for all staff (Settings → General), and can reset it for
 * someone who lost their phone. Ten single-use recovery codes are shown once when it's turned on.
 */
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import type { DbOrTx } from "../db";
import { users, type User } from "../db/schema";
import { AppError } from "../errors";
import { decryptBuffer, encryptBuffer, hmac } from "../crypto";
import { env } from "../env";
import { isStaffRole } from "../domain";
import { newRecoveryCodes, newTotpSecret, totpUri, verifyTotp } from "../totp";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { rateLimit } from "./rate-limit";

const seal = (secret: string) => encryptBuffer(Buffer.from(secret, "utf8")).toString("base64");
const unseal = (enc: string) => decryptBuffer(Buffer.from(enc, "base64")).toString("utf8");
const recoveryHash = (userId: string, code: string) => hmac(`totp-recovery:${userId}:${code.trim().toLowerCase()}`);

export type TwoFactorStatus = { enabled: boolean; enabledAt: Date | null; recoveryLeft: number; required: boolean };

/** Whether this user's sign-in needs the second step. */
export const needsSecondStep = (u: Pick<User, "role" | "totpEnabledAt">) => isStaffRole(u.role) && !!u.totpEnabledAt;

export async function staffTwoFactorRequired(db: DbOrTx): Promise<boolean> {
  return (await getSettings(db)).require_staff_2fa;
}

export async function getTwoFactorStatus(db: DbOrTx, user: User): Promise<TwoFactorStatus> {
  return { enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt, recoveryLeft: user.totpRecoveryHashes.length, required: isStaffRole(user.role) && (await staffTwoFactorRequired(db)) };
}

/** Step 1: a new secret (kept, not yet on) and its QR code for the authenticator app. */
export async function startTwoFactorSetup(db: DbOrTx, user: User): Promise<{ secret: string; uri: string; qrSvg: string }> {
  if (!isStaffRole(user.role)) throw new AppError("forbidden");
  if (user.totpEnabledAt) throw new AppError("conflict", "Two-step sign-in is already on");
  const secret = newTotpSecret();
  await db.update(users).set({ totpSecretEnc: seal(secret), totpLastStep: null }).where(eq(users.id, user.id));
  const uri = totpUri(secret, user.email, env.appName);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, uri, qrSvg };
}

/** Step 2: the first code from the app turns it on; returns the recovery codes (shown once). */
export async function confirmTwoFactorSetup(db: DbOrTx, user: User, code: string, ip: string | null = null): Promise<string[]> {
  if (!isStaffRole(user.role)) throw new AppError("forbidden");
  if (user.totpEnabledAt) throw new AppError("conflict");
  if (!user.totpSecretEnc) throw new AppError("validation", "Start the setup first");
  await rateLimit(db, `totp:${user.id}`, 10, 15 * 60);
  const step = verifyTotp(unseal(user.totpSecretEnc), code);
  if (step === null) throw new AppError("invalid_code");
  const codes = newRecoveryCodes();
  await db
    .update(users)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryHashes: codes.map((c) => recoveryHash(user.id, c)) })
    .where(eq(users.id, user.id));
  await audit(db, { actorId: user.id, action: "auth.2fa_on", entityType: "user", entityId: user.id, ip });
  return codes;
}

/**
 * Checks a code from the app, or a recovery code (used up). Limited to 10 tries in 15 minutes.
 * Returns how it was checked.
 */
export async function checkSecondStep(db: DbOrTx, user: User, code: string): Promise<"app" | "recovery"> {
  if (!user.totpEnabledAt || !user.totpSecretEnc) throw new AppError("validation");
  await rateLimit(db, `totp:${user.id}`, 10, 15 * 60);
  const c = code.trim();
  if (/^\d{3}\s?\d{3}$/.test(c)) {
    const step = verifyTotp(unseal(user.totpSecretEnc), c.replace(/\s/g, ""), { lastUsedStep: user.totpLastStep });
    if (step === null) throw new AppError("invalid_code");
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    return "app";
  }
  const h = recoveryHash(user.id, c);
  if (!user.totpRecoveryHashes.includes(h)) throw new AppError("invalid_code");
  await db
    .update(users)
    .set({ totpRecoveryHashes: user.totpRecoveryHashes.filter((x) => x !== h) })
    .where(eq(users.id, user.id));
  return "recovery";
}

/** New recovery codes (the old ones stop working); needs a current code. */
export async function regenerateRecoveryCodes(db: DbOrTx, user: User, code: string): Promise<string[]> {
  await checkSecondStep(db, user, code);
  const [fresh] = await db.select().from(users).where(eq(users.id, user.id));
  const codes = newRecoveryCodes();
  await db.update(users).set({ totpRecoveryHashes: codes.map((c) => recoveryHash(fresh!.id, c)) }).where(eq(users.id, user.id));
  await audit(db, { actorId: user.id, action: "auth.2fa_recovery_codes", entityType: "user", entityId: user.id });
  return codes;
}

/** Turns it off (needs a current code); not while the office requires it. */
export async function disableTwoFactor(db: DbOrTx, user: User, code: string, ip: string | null = null) {
  if (await staffTwoFactorRequired(db)) throw new AppError("mfa_required");
  await checkSecondStep(db, user, code);
  await db.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, totpRecoveryHashes: [], totpLastStep: null }).where(eq(users.id, user.id));
  await audit(db, { actorId: user.id, action: "auth.2fa_off", entityType: "user", entityId: user.id, ip });
}

/** An admin turns it off for a team member who lost their phone; they set it up again at their next sign-in. */
export async function resetTwoFactor(db: DbOrTx, admin: User, userId: string) {
  if (admin.role !== "admin") throw new AppError("forbidden");
  if (admin.id === userId) throw new AppError("validation", "Use My account to change your own");
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !isStaffRole(u.role)) throw new AppError("not_found");
  await db.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, totpRecoveryHashes: [], totpLastStep: null }).where(eq(users.id, userId));
  await audit(db, { actorId: admin.id, action: "auth.2fa_reset", entityType: "user", entityId: userId });
}
