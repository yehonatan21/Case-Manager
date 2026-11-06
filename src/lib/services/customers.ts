import { and, desc, eq, ilike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { cases, customers, customerTypeEnum, organizations, users, type CustomerType } from "../db/schema";

export const CUSTOMERS_PAGE_SIZE = 50;

/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally. */
export const likeTerm = (q: string) => `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Matches a phone column however it was typed: "050-123 4567", "0501234567" and "+972 50 123 4567" all match
 * a search for any of them (digits only, without the leading 0 or 972).
 */
export function phoneMatches(column: AnyColumn, q: string): SQL | undefined {
  const core = q.replace(/\D/g, "").replace(/^(972|0)/, "");
  if (core.length < 3 || core.length !== q.replace(/[\s()+-]/g, "").replace(/^(972|0)/, "").length) return undefined;
  return sql`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g') like ${`%${core}%`}`;
}

/**
 * Clients, newest first, searched on the server by name, email, phone or organization, a page at a time.
 * `total` counts every match, for paging.
 */
export async function listCustomers(db: DbOrTx, opts: { q?: string; type?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(opts.pageSize ?? CUSTOMERS_PAGE_SIZE, 1), 500);
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const conds: (SQL | undefined)[] = [];
  const q = opts.q?.trim();
  if (q) {
    const like = likeTerm(q);
    conds.push(
      or(
        ilike(users.name, like),
        ilike(users.email, like),
        ilike(organizations.name, like),
        ilike(users.phone, like),
        phoneMatches(users.phone, q),
      ),
    );
  }
  if (opts.type && (customerTypeEnum.enumValues as readonly string[]).includes(opts.type)) conds.push(eq(customers.type, opts.type as CustomerType));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [count]] = await Promise.all([
    db
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
      .where(where)
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.userId))
      .leftJoin(organizations, eq(organizations.id, customers.organizationId))
      .where(where),
  ]);
  const total = count?.n ?? 0;
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
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
