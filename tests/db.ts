import path from "node:path";
import { createPgliteDatabase, type Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";

/**
 * Isolated database for integration tests: in-memory PGlite by default,
 * or a real PostgreSQL when TEST_DATABASE_URL is set (the schema is reset first).
 */
export async function createTestDatabase(): Promise<Database> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return createPgliteDatabase();
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db as unknown as Database;
}
