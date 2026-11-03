import crypto from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db";
import { authCodes, users, type CustomerType, type User } from "../db/schema";
import { AppError } from "../errors";
import { env } from "../env";
import { hmac, safeEqual } from "../crypto";
import { rateLimit } from "./rate-limit";
import { audit } from "./audit";
import { createCustomerAccount, findUserByEmail, normalizeEmail } from "./users";
import { sendEmail, renderEmail } from "../email";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

const codeHash = (email: string, code: string) => hmac(`otp:${email}:${code}`);

/** Sign-in codes are shown on screen only in local development or an explicit public demo. */
export function devCodeVisible() {
  return env.demoMode || (env.emailProvider === "console" && !env.isProd);
}

/** Passwordless sign-in: emails a 6-digit one-time code. Rate limited per email and per IP. */
export async function requestLoginCode(db: Database, input: { email: string; ip: string | null; locale: Locale }) {
  const email = normalizeEmail(input.email);
  await rateLimit(db, `otp:email:${email}`, 5, 15 * 60);
  if (input.ip) await rateLimit(db, `otp:ip:${input.ip}`, 30, 15 * 60);

  const existing = await findUserByEmail(db, email);
  if (existing?.status === "disabled") throw new AppError("account_disabled");

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(authCodes).values({
    email,
    codeHash: codeHash(email, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000),
    ip: input.ip,
  });

  const locale = (existing?.locale as Locale) ?? input.locale;
  const d = dictionaries[locale];
  const subject = fmt(d.email.otpSubject, { code });
  const body = fmt(d.email.otpBody, { code });
  const { text, html } = renderEmail({
    locale,
    greeting: fmt(d.email.greeting, { name: existing?.name ?? "" }),
    title: subject,
    body,
    footer: fmt(d.email.footer, { app: env.appName }),
  });
  await sendEmail({ to: email, subject, text, html });
  return { existingUser: !!existing, devCode: devCodeVisible() ? code : undefined };
}

export type SignupInput = {
  name: string;
  phone?: string | null;
  customerType: CustomerType;
  organizationName?: string | null;
  organizationNumber?: string | null;
  acceptTerms: boolean;
  aiConsent: boolean;
};

/**
 * Verifies a one-time code. Creates a customer account when the email is new and signup details
 * are provided; otherwise asks for them (without consuming the code).
 */
export async function verifyLoginCode(
  db: Database,
  input: { email: string; code: string; ip: string | null; locale: Locale; signup?: SignupInput | null },
): Promise<{ user: User; created: boolean }> {
  const email = normalizeEmail(input.email);
  if (input.ip) await rateLimit(db, `verify:ip:${input.ip}`, 60, 15 * 60);

  const [latest] = await db
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.email, email), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date())))
    .orderBy(desc(authCodes.createdAt))
    .limit(1);
  if (!latest) throw new AppError("code_expired");
  if (latest.attempts >= MAX_ATTEMPTS) throw new AppError("too_many_attempts");

  if (!safeEqual(latest.codeHash, codeHash(email, input.code.trim()))) {
    await db.update(authCodes).set({ attempts: latest.attempts + 1 }).where(eq(authCodes.id, latest.id));
    throw new AppError(latest.attempts + 1 >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code");
  }

  let user = await findUserByEmail(db, email);
  if (!user && !input.signup) throw new AppError("signup_required");
  if (user?.status === "disabled") throw new AppError("account_disabled");
  if (!user && input.signup && !input.signup.acceptTerms) throw new AppError("terms_required");

  return db.transaction(async (tx) => {
    await tx.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, latest.id));
    let created = false;
    if (!user) {
      const s = input.signup!;
      if (!s.name?.trim()) throw new AppError("validation");
      user = await createCustomerAccount(tx, {
        email,
        name: s.name,
        phone: s.phone,
        locale: input.locale,
        customerType: s.customerType,
        organizationName: s.organizationName,
        organizationNumber: s.organizationNumber,
        aiConsent: s.aiConsent,
      });
      created = true;
    }
    const patch: Partial<User> = { lastLoginAt: new Date() };
    if (user.status === "invited") patch.status = "active";
    await tx.update(users).set(patch).where(eq(users.id, user.id));
    await audit(tx, { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, ip: input.ip });
    return { user: { ...user, ...patch } as User, created };
  });
}
