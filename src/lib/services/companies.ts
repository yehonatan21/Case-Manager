import { and, asc, eq, ne } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { customers, organizations, users, type OrgAccess, type OrgRole, type User } from "../db/schema";
import { AppError } from "../errors";
import { audit } from "./audit";
import { notify } from "./notifications";

export const ORG_ROLES: OrgRole[] = ["owner", "contact", "billing", "signatory"];
export const ORG_ACCESS: OrgAccess[] = ["all", "own"];

/** Admins and case managers manage clients' company contacts. */
const canManage = (actor: User) => actor.role === "admin" || actor.role === "case_manager";

async function customerById(db: DbOrTx, customerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) throw new AppError("not_found");
  const [row] = await db.select({ c: customers, u: users }).from(customers).innerJoin(users, eq(users.id, customers.userId)).where(eq(customers.id, customerId));
  if (!row) throw new AppError("not_found");
  return row;
}

/** The client's company and everyone in it (with their role and what they may see). */
export async function getCompany(db: DbOrTx, customerId: string) {
  const { c } = await customerById(db, customerId);
  if (!c.organizationId) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, c.organizationId));
  const members = await db
    .select({ customerId: customers.id, userId: users.id, name: users.name, email: users.email, phone: users.phone, role: customers.orgRole, access: customers.orgAccess, status: users.status })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.organizationId, c.organizationId))
    .orderBy(asc(users.name));
  return { id: org!.id, name: org!.name, businessId: org!.businessId, members };
}

/** Turns a client into a company account (the client becomes its owner). */
export async function makeCompany(db: DbOrTx, actor: User, customerId: string, input: { name: string; businessId?: string | null }) {
  if (!canManage(actor)) throw new AppError("forbidden");
  const { c } = await customerById(db, customerId);
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new AppError("validation");
  if (c.organizationId) {
    await db.update(organizations).set({ name, businessId: input.businessId?.trim() || null }).where(eq(organizations.id, c.organizationId));
    // An owner sees all the company's cases.
    if (c.orgRole === "owner" && c.orgAccess !== "all") await db.update(customers).set({ orgAccess: "all" }).where(eq(customers.id, c.id));
    return c.organizationId;
  }
  const [org] = await db.insert(organizations).values({ name, businessId: input.businessId?.trim() || null }).returning();
  await db.update(customers).set({ organizationId: org!.id, orgRole: "owner", orgAccess: "all", type: c.type === "private" ? "company" : c.type }).where(eq(customers.id, c.id));
  await audit(db, { actorId: actor.id, action: "company.create", entityType: "user", entityId: c.userId, details: { name } });
  return org!.id;
}

export type ContactInput = { name: string; email: string; phone?: string | null; role: OrgRole; access: OrgAccess; locale?: "he" | "en" };

/**
 * Adds a contact to a client's company: a new client account for a new email, or an existing client who isn't
 * in another company yet. They sign in with that email; they are told by email and in the app.
 */
export async function addCompanyContact(db: DbOrTx, actor: User, customerId: string, input: ContactInput) {
  if (!canManage(actor)) throw new AppError("forbidden");
  if (!ORG_ROLES.includes(input.role) || !ORG_ACCESS.includes(input.access)) throw new AppError("validation");
  const { c: owner } = await customerById(db, customerId);
  if (!owner.organizationId) throw new AppError("validation", "not a company");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, owner.organizationId));
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new AppError("validation");
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  let memberUserId: string;
  if (existing) {
    if (existing.role !== "customer") throw new AppError("staff_email");
    if (existing.status === "disabled") throw new AppError("account_disabled");
    const [cust] = await db.select().from(customers).where(eq(customers.userId, existing.id));
    if (!cust) throw new AppError("conflict");
    if (cust.organizationId && cust.organizationId !== owner.organizationId) throw new AppError("conflict", "in another company");
    await db.update(customers).set({ organizationId: owner.organizationId, orgRole: input.role, orgAccess: input.access }).where(eq(customers.id, cust.id));
    memberUserId = existing.id;
  } else {
    const [u] = await db
      .insert(users)
      .values({ email, name, phone: input.phone?.trim() || null, role: "customer", status: "active", locale: input.locale ?? "he" })
      .returning();
    await db.insert(customers).values({ userId: u!.id, type: owner.type === "private" ? "company" : owner.type, organizationId: owner.organizationId, orgRole: input.role, orgAccess: input.access });
    memberUserId = u!.id;
  }
  await notify(db, { userIds: [memberUserId], type: "company_contact_added", vars: { company: org?.name ?? "" }, link: "/portal" });
  await audit(db, { actorId: actor.id, action: "company.add_contact", entityType: "user", entityId: memberUserId, details: { role: input.role, access: input.access } });
  return memberUserId;
}

/** Changes a contact's role or what they may see. A company keeps at least one owner. */
export async function updateCompanyContact(db: DbOrTx, actor: User, memberCustomerId: string, input: { role: OrgRole; access: OrgAccess }) {
  if (!canManage(actor)) throw new AppError("forbidden");
  if (!ORG_ROLES.includes(input.role) || !ORG_ACCESS.includes(input.access)) throw new AppError("validation");
  const { c } = await customerById(db, memberCustomerId);
  if (!c.organizationId) throw new AppError("validation");
  if (c.orgRole === "owner" && input.role !== "owner") await keepAnOwner(db, c.organizationId, c.id);
  await db.update(customers).set({ orgRole: input.role, orgAccess: input.access }).where(eq(customers.id, c.id));
  await audit(db, { actorId: actor.id, action: "company.update_contact", entityType: "user", entityId: c.userId, details: input });
}

/** Takes a contact out of the company; they keep their own cases. */
export async function removeCompanyContact(db: DbOrTx, actor: User, memberCustomerId: string) {
  if (!canManage(actor)) throw new AppError("forbidden");
  const { c } = await customerById(db, memberCustomerId);
  if (!c.organizationId) return;
  if (c.orgRole === "owner") await keepAnOwner(db, c.organizationId, c.id);
  await db.update(customers).set({ organizationId: null, orgRole: "owner", orgAccess: "own" }).where(eq(customers.id, c.id));
  await audit(db, { actorId: actor.id, action: "company.remove_contact", entityType: "user", entityId: c.userId });
}

async function keepAnOwner(db: DbOrTx, organizationId: string, leavingCustomerId: string) {
  const [other] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.orgRole, "owner"), ne(customers.id, leavingCustomerId)))
    .limit(1);
  if (!other) throw new AppError("validation", "a company needs an owner");
}
