import { desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { cases, customers, organizations, users } from "../db/schema";

export async function listCustomers(db: DbOrTx) {
  return db
    .select({
      id: customers.id,
      type: customers.type,
      createdAt: customers.createdAt,
      name: users.name,
      email: users.email,
      phone: users.phone,
      organization: organizations.name,
      caseCount: sql<number>`(select count(*)::int from ${cases} where ${cases.customerId} = ${customers.id})`,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(organizations, eq(organizations.id, customers.organizationId))
    .orderBy(desc(customers.createdAt))
    .limit(500);
}

export async function getCustomer(db: DbOrTx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ customer: customers, user: users, organization: organizations })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(organizations, eq(organizations.id, customers.organizationId))
    .where(eq(customers.id, id));
  return row ?? null;
}
