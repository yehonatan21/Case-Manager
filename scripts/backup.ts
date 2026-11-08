/**
 * Backs up the whole database to an encrypted file (APP_SECRET is the key), then checks the file by restoring it
 * into a throwaway in-memory database. Nothing in the source database is changed.
 *   npm run db:backup                     # from DATABASE_URL_UNPOOLED / DATABASE_URL, into ./backups/
 *   npm run db:backup -- --out somewhere/
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, createPgliteDatabase } from "../src/lib/db";
import { createBackup, restoreBackup } from "../src/lib/backup";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : "backups";
  // Locally without Postgres: the embedded database in PGLITE_DIR.
  const { db, close } = url
    ? await connectDatabase(url)
    : process.env.PGLITE_DIR
      ? { db: await createPgliteDatabase(process.env.PGLITE_DIR), close: async () => {} }
      : (() => {
          throw new Error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to the database to back up.");
        })();
  const { file, meta } = await createBackup(db).finally(close);
  fs.mkdirSync(out, { recursive: true });
  const name = path.join(out, `case-manager-${meta.createdAt.replace(/[:.]/g, "-")}.cmbk`);
  fs.writeFileSync(name, file);
  // A backup counts only once it has been restored somewhere.
  const check = await restoreBackup(await createPgliteDatabase(), file);
  const summary = { file: name, bytes: file.length, createdAt: meta.createdAt, tables: check.tables, rows: check.rows, restoreTested: true };
  console.log(JSON.stringify(summary));
  return summary;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("BACKUP FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
