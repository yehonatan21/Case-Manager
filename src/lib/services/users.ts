import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { cases, customers, organizations, users, type CustomerType, type User, type UserRole } from "../db/schema";
import { AppError } from "../errors";
import { audit } from "./audit";
import { STAFF_ROLES } from "../domain";
import type { Locale } from "../i18n/config";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(db: DbOrTx, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return u ?? null;
}

export async function createCustomerAccount(
  db: DbOrTx,
  input: { email: string; name: string; phone?: string | null; locale: Locale; customerType: CustomerType; organizationName?: string | null; organizationNumber?: string | null; aiConsent: boolean },
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      role: "customer",
      status: "active",
      locale: input.locale,
      termsAcceptedAt: new Date(),
      aiConsentAt: input.aiConsent ? new Date() : null,
      aiConsentDeclinedAt: input.aiConsent ? null : new Date(),
    })
    .returning();
  let organizationId: string | null = null;
  if ((input.customerType === "business" || input.customerType === "company") && input.organizationName?.trim()) {
    const [org] = await db
      .insert(organizations)
      .values({ name: input.organizationName.trim(), businessId: input.organizationNumber?.trim() || null })
      .returning();
    organizationId = org!.id;
  }
  // A client who registers a company is its owner and sees all its cases.
  await db.insert(customers).values({ userId: user!.id, type: input.customerType, organizationId, orgRole: "owner", orgAccess: organizationId ? "all" : "own" });
  await audit(db, { actorId: user!.id, action: "user.signup", entityType: "user", entityId: user!.id });
  return user!;
}

export async function getCustomerForUser(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({ customer: customers, organization: organizations })
    .from(customers)
    .leftJoin(organizations, eq(organizations.id, customers.organizationId))
    .where(eq(customers.userId, userId));
  return row ?? null;
}

export async function updateProfile(
  db: DbOrTx,
  user: User,
  patch: { name?: string; phone?: string | null; locale?: Locale; emailNotifications?: boolean; aiConsent?: boolean },
) {
  const set = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
    ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
    ...(patch.emailNotifications !== undefined ? { emailNotifications: patch.emailNotifications } : {}),
    // Agreeing keeps the original time; changing the answer records when.
    ...(patch.aiConsent === true && !user.aiConsentAt ? { aiConsentAt: new Date(), aiConsentDeclinedAt: null } : {}),
    ...(patch.aiConsent === false ? { aiConsentAt: null, aiConsentDeclinedAt: user.aiConsentDeclinedAt ?? new Date() } : {}),
  };
  // Nothing to change (e.g. only the WhatsApp setting was sent).
  if (Object.keys(set).length === 0) return;
  await db.update(users).set(set).where(eq(users.id, user.id));
  if (patch.aiConsent !== undefined && patch.aiConsent !== !!user.aiConsentAt) {
    await audit(db, { actorId: user.id, action: patch.aiConsent ? "user.ai_consent_given" : "user.ai_consent_withdrawn", entityType: "user", entityId: user.id });
  }
}

export async function listStaff(db: DbOrTx, opts: { includeDisabled?: boolean } = {}) {
  return db
    .select()
    .from(users)
    .where(opts.includeDisabled ? inArray(users.role, STAFF_ROLES) : and(inArray(users.role, STAFF_ROLES), ne(users.status, "disabled")))
    .orderBy(asc(users.name));
}

export async function listAssignableStaff(db: DbOrTx) {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inArray(users.role, ["admin", "case_manager", "staff"]), ne(users.status, "disabled")))
    .orderBy(asc(users.name));
}

export type InviteOutcome = "invited" | "converted" | "reactivated";

/**
 * Adds a team member by email. Handles accounts that already use the email:
 * - a disabled team member is re-enabled with the chosen role;
 * - a client account with no requests (e.g. someone who signed up to try the site) becomes a team account;
 * - an active or invited team member, or a client who has requests, is refused with a specific error.
 */
export async function inviteStaff(db: DbOrTx, actor: User, input: { email: string; name: string; role: UserRole }): Promise<{ user: User; outcome: InviteOutcome }> {
  if (actor.role !== "admin") throw new AppError("forbidden");
  if (input.role === "customer") throw new AppError("validation");
  const existing = await findUserByEmail(db, input.email);

  if (existing && existing.role !== "customer") {
    if (existing.status !== "disabled") throw new AppError("already_team_member");
    const [u] = await db.update(users).set({ role: input.role, status: "active" }).where(eq(users.id, existing.id)).returning();
    await audit(db, { actorId: actor.id, action: "user.reactivate", entityType: "user", entityId: existing.id, details: { role: input.role } });
    return { user: u!, outcome: "reactivated" };
  }

  if (existing) {
    const [cust] = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, existing.id));
    if (cust) {
      const [hasCase] = await db.select({ id: cases.id }).from(cases).where(eq(cases.customerId, cust.id)).limit(1);
      if (hasCase) throw new AppError("email_is_client");
      await db.delete(customers).where(eq(customers.id, cust.id));
    }
    const [u] = await db.update(users).set({ role: input.role, status: existing.status === "disabled" ? "active" : existing.status }).where(eq(users.id, existing.id)).returning();
    await audit(db, { actorId: actor.id, action: "user.convert_to_staff", entityType: "user", entityId: existing.id, details: { role: input.role } });
    return { user: u!, outcome: "converted" };
  }

  const [u] = await db
    .insert(users)
    .values({ email: normalizeEmail(input.email), name: input.name.trim(), role: input.role, status: "invited" })
    .returning();
  await audit(db, { actorId: actor.id, action: "user.invite", entityType: "user", entityId: u!.id, details: { role: input.role } });
  return { user: u!, outcome: "invited" };
}

export async function updateStaffUser(db: DbOrTx, actor: User, userId: string, patch: { role?: UserRole; status?: "active" | "disabled" }) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  if (userId === actor.id && (patch.status === "disabled" || (patch.role && patch.role !== "admin"))) {
    throw new AppError("validation", "You cannot demote or disable yourself");
  }
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target || target.role === "customer") throw new AppError("not_found");
  if (patch.role === "customer") throw new AppError("validation");
  await db.update(users).set(patch).where(eq(users.id, userId));
  await audit(db, { actorId: actor.id, action: "user.update", entityType: "user", entityId: userId, details: patch });
}
