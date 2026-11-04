import { eq } from "drizzle-orm";
import { setDbOverride, type Database } from "@/lib/db";
import { seedBase } from "@/lib/db/seed";
import * as s from "@/lib/db/schema";
import { AppError, type ErrorCode } from "@/lib/errors";
import { createIntake } from "@/lib/services/intake";
import { submitIntakeAsCase, assignCase } from "@/lib/services/cases";
import { createDraftQuote, updateDraftQuote, sendQuote } from "@/lib/services/quotes";
import { createTestDatabase } from "./db";

/** Fresh, migrated, base-seeded database used by every service in this test file. */
export async function setupDb(): Promise<Database> {
  const db = await createTestDatabase();
  await seedBase(db);
  setDbOverride(db);
  return db;
}

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}@example.com`;

export async function makeUser(db: Database, role: s.UserRole, opts: { email?: string; status?: "active" | "invited" | "disabled"; aiConsent?: boolean; locale?: "he" | "en" } = {}) {
  const [u] = await db
    .insert(s.users)
    .values({
      email: opts.email ?? uniq(role),
      name: `${role} user`,
      role,
      status: opts.status ?? "active",
      locale: opts.locale ?? "he",
      termsAcceptedAt: role === "customer" ? new Date() : null,
      aiConsentAt: role === "customer" && opts.aiConsent !== false ? new Date() : null,
    })
    .returning();
  if (role === "customer") await db.insert(s.customers).values({ userId: u!.id, type: "private" });
  return u!;
}

export async function getAdmin(db: Database) {
  const [a] = await db.select().from(s.users).where(eq(s.users.role, "admin"));
  return a!;
}

/** Submits a request through the real manual-intake path and returns the new case. */
export async function makeCase(db: Database, customer: s.User, title = "Test request") {
  const session = await createIntake(db, { message: null, locale: "en", user: customer, ownerToken: `owner-${++seq}`, ip: null, mode: "manual" });
  return submitIntakeAsCase(db, {
    user: customer,
    session,
    edits: {
      request_title: title,
      request_description: "Details of the request",
      customer_goal: "Goal",
      service_category: "other",
      urgency: "normal",
      known_facts: [],
      constraints: [],
      missing_information: ["Target date"],
    },
  });
}

export const quoteInput = (cents = 100000, validUntil: string | null = null) => ({
  serviceName: "Service",
  scope: "Scope",
  included: "a",
  excluded: "b",
  currency: "ILS",
  taxRate: 18,
  pricesIncludeTax: false,
  paymentTerms: "Full",
  timeline: "",
  terms: "",
  validUntil,
  items: [{ description: "Item", quantity: 1, unitPriceCents: cents }],
});

/** A case with a sent quote, assigned to `staff` (defaults to the admin). */
export async function caseWithSentQuote(db: Database, customer: s.User, staff?: s.User) {
  const admin = await getAdmin(db);
  const c = await makeCase(db, customer);
  await assignCase(db, admin, c.id, (staff ?? admin).id);
  const q = await createDraftQuote(db, admin, c.id);
  await updateDraftQuote(db, admin, q.id, quoteInput());
  await sendQuote(db, admin, q.id);
  return { c, quoteId: q.id, admin };
}

/** Expect a promise to reject with a specific domain error code. */
export async function expectCode(p: Promise<unknown>, code: ErrorCode) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!(err instanceof AppError)) throw new Error(`Expected AppError(${code}), got ${err instanceof Error ? err.message : String(err)}`);
  if (err.code !== code) throw new Error(`Expected AppError(${code}), got AppError(${err.code}): ${err.message}`);
}
