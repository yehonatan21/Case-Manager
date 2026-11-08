import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import type { Database } from "./db";
import * as schema from "./db/schema";
import crypto from "node:crypto";
import { sha256 } from "./crypto";
import { env } from "./env";

/**
 * Whole-database backups: every table's rows as JSON, gzipped and encrypted (AES-256-GCM) with BACKUP_SECRET,
 * a key of its own kept outside the app (in the backup workflow and the owner's password manager). Rows that the
 * app itself encrypted (stored files, saved integration keys) stay encrypted inside, so a restored database is
 * used by the same deployment, with the same APP_SECRET. Without BACKUP_SECRET (local use, tests) the key is
 * derived from APP_SECRET. A restore goes into an empty, migrated
 * database and checks the row counts and a fingerprint of each table.
 */
export const BACKUP_FORMAT = 1;
const MAGIC = Buffer.from("CMBK1\n");

function backupKey(): Buffer {
  const secret = process.env.BACKUP_SECRET?.trim() || `app:${env.appSecret}`;
  return crypto.createHash("sha256").update(`case-manager-backup:${secret}`).digest();
}
function seal(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", backupKey(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
function open(data: Buffer): Buffer {
  const d = crypto.createDecipheriv("aes-256-gcm", backupKey(), data.subarray(0, 12));
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]);
}

type Meta = { format: number; createdAt: string; migration: string | null; tables: Record<string, { rows: number; sha256: string }> };
type Dump = Meta & { data: Record<string, Record<string, unknown>[]> };

const allTables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

/** Tables in an order where each comes after the tables it references (so inserts never break a foreign key). */
export function tablesInDependencyOrder(): PgTable[] {
  const name = (t: PgTable) => getTableConfig(t).name;
  const deps = new Map(allTables.map((t) => [name(t), new Set(getTableConfig(t).foreignKeys.map((fk) => name(fk.reference().foreignTable)).filter((n) => n !== name(t)))]));
  const out: PgTable[] = [];
  const done = new Set<string>();
  while (out.length < allTables.length) {
    const before = out.length;
    for (const t of allTables) {
      const n = name(t);
      if (done.has(n) || [...deps.get(n)!].some((d) => !done.has(d))) continue;
      out.push(t);
      done.add(n);
    }
    if (out.length === before) throw new Error("circular foreign keys between tables");
  }
  return out;
}

/** JSON can't hold bytes or dates as such: bytes become {$b64}, dates ISO strings (turned back on restore). */
const encode = (v: unknown): unknown => (Buffer.isBuffer(v) || v instanceof Uint8Array ? { $b64: Buffer.from(v).toString("base64") } : v instanceof Date ? v.toISOString() : v);
const fingerprint = (rows: unknown[]) => sha256(JSON.stringify(rows));

async function lastMigration(db: Database): Promise<string | null> {
  try {
    const r = await db.execute(sql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`);
    const rows = (r as unknown as { rows?: { hash: string }[] }).rows ?? (r as unknown as { hash: string }[]);
    return rows[0]?.hash ?? null;
  } catch {
    return null;
  }
}

/** Reads every table (rows sorted by primary key, so two backups of the same data are identical). */
export async function createBackup(db: Database): Promise<{ file: Buffer; meta: Meta }> {
  const data: Dump["data"] = {};
  const tables: Meta["tables"] = {};
  for (const t of tablesInDependencyOrder()) {
    const cfg = getTableConfig(t);
    const raw = (await db.select().from(t)) as Record<string, unknown>[];
    const rows = raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encode(v)]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    data[cfg.name] = rows;
    tables[cfg.name] = { rows: rows.length, sha256: fingerprint(rows) };
  }
  const meta: Meta = { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), migration: await lastMigration(db), tables };
  const json = JSON.stringify({ ...meta, data } satisfies Dump);
  const file = Buffer.concat([MAGIC, seal(Buffer.from(gzipSync(strToU8(json), { level: 9 })))]);
  return { file, meta };
}

/** Opens a backup file (checks it's ours, and that it decrypts with this BACKUP_SECRET). */
export function readBackup(file: Buffer): Dump {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a Case Manager backup file");
  let plain: Buffer;
  try {
    plain = open(file.subarray(MAGIC.length));
  } catch {
    throw new Error("the backup can't be decrypted: BACKUP_SECRET differs from the one it was made with");
  }
  const dump = JSON.parse(strFromU8(gunzipSync(plain))) as Dump;
  if (dump.format !== BACKUP_FORMAT) throw new Error(`unsupported backup format ${dump.format}`);
  return dump;
}

/**
 * Restores a backup into an empty database that has the same migrations, in one transaction, then compares each
 * table's row count and fingerprint with the backup's. Throws (and changes nothing) on any difference.
 */
export async function restoreBackup(db: Database, file: Buffer): Promise<{ tables: number; rows: number }> {
  const dump = readBackup(file);
  const migration = await lastMigration(db);
  if (dump.migration && migration && dump.migration !== migration) throw new Error("the database's migrations differ from the backup's; migrate it to the same version first");
  const order = tablesInDependencyOrder();
  let rows = 0;
  await db.transaction(async (tx) => {
    for (const t of order) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t);
      if (n > 0) throw new Error(`the database isn't empty (table ${getTableConfig(t).name} has rows); restore into a new, migrated database`);
    }
    for (const t of order) {
      const cfg = getTableConfig(t);
      const list = dump.data[cfg.name] ?? [];
      // Columns by their TypeScript key, to turn ISO strings back into dates and {$b64} back into bytes.
      const cols = Object.entries(t as unknown as Record<string, { columnType?: string; dataType?: string }>).filter(([, c]) => c && typeof c === "object" && "columnType" in c);
      const kind = new Map(cols.map(([k, c]) => [k, c.columnType ?? ""]));
      const decoded = list.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => {
            if (v && typeof v === "object" && "$b64" in (v as object)) return [k, Buffer.from((v as { $b64: string }).$b64, "base64")];
            if (typeof v === "string" && kind.get(k) === "PgTimestamp") return [k, new Date(v)];
            return [k, v];
          }),
        ),
      );
      for (let i = 0; i < decoded.length; i += 500) await tx.insert(t).values(decoded.slice(i, i + 500) as never);
      rows += decoded.length;
    }
  });
  // The tested part of a tested restore: the data that went in is the data that came out.
  const check = await createBackup(db);
  for (const [name, m] of Object.entries(dump.tables)) {
    const got = check.meta.tables[name];
    if (!got || got.rows !== m.rows || got.sha256 !== m.sha256) throw new Error(`restore check failed for ${name}: expected ${m.rows} rows, got ${got?.rows ?? 0}`);
  }
  return { tables: Object.keys(dump.tables).length, rows };
}
