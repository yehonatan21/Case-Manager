import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "../env";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

type GlobalDb = { __cmDb?: Promise<Database>; __cmDbOverride?: Database };
const g = globalThis as unknown as GlobalDb;

async function createPgDatabase(url: string): Promise<Database> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE || (env.isVercel ? 3 : 10)) });
  const db = drizzle({ client: pool, schema }) as unknown as Database;
  if (env.autoMigrate) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const client = await pool.connect();
    try {
      // Serialise concurrent migrations across instances.
      await client.query("select pg_advisory_lock(727274)");
      await migrate(drizzle({ client, schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query("select pg_advisory_unlock(727274)").catch(() => {});
      client.release();
    }
  }
  return db;
}

/**
 * A connection for scripts that must not change the database (backups): no migrations, no seed.
 * With `migrate`, migrations run first (a restore target), still without the seed.
 */
export async function connectDatabase(url: string, opts: { migrate?: boolean } = {}): Promise<{ db: Database; close: () => Promise<void> }> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle({ client: pool, schema }) as unknown as Database;
  if (opts.migrate) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
  return { db, close: () => pool.end() };
}

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Database;
}

async function init(): Promise<Database> {
  if (env.isVercel && !env.databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add a Neon database under Storage in your Vercel project and redeploy.");
  }
  const db = env.databaseUrl
    ? await createPgDatabase(env.databaseUrl)
    : await createPgliteDatabase(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.pgliteDir));
  const { ensureSeed } = await import("./seed");
  await ensureSeed(db);
  return db;
}

export function getDb(): Promise<Database> {
  if (g.__cmDbOverride) return Promise.resolve(g.__cmDbOverride);
  if (!g.__cmDb) {
    g.__cmDb = init().catch((err) => {
      g.__cmDb = undefined;
      throw err;
    });
  }
  return g.__cmDb;
}

/** Used by tests to inject an isolated in-memory database. */
export function setDbOverride(db: Database | undefined) {
  g.__cmDbOverride = db;
}

export async function dbHealthy(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export { schema };
