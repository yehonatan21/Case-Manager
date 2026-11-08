/**
 * Restores a backup made by `npm run db:backup`. Needs the same BACKUP_SECRET it was made with.
 *   npm run db:restore -- backups/file.cmbk --verify        # restore into a throwaway database and check it
 *   npm run db:restore -- backups/file.cmbk --into <url>    # restore into a NEW, empty database (migrated first)
 * The target must be empty: this never overwrites data. For a live site, restore into a new Neon branch or
 * database, check it, then point DATABASE_URL at it.
 */
import "dotenv/config";
import fs from "node:fs";
import { connectDatabase, createPgliteDatabase } from "../src/lib/db";
import { readBackup, restoreBackup } from "../src/lib/backup";

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Usage: npm run db:restore -- <backup file> (--verify | --into <database url>)");
  const data = fs.readFileSync(file);
  const meta = readBackup(data);
  console.log(`Backup from ${meta.createdAt}: ${Object.values(meta.tables).reduce((a, t) => a + t.rows, 0)} rows in ${Object.keys(meta.tables).length} tables.`);
  if (process.argv.includes("--into")) {
    const url = process.argv[process.argv.indexOf("--into") + 1];
    if (!url) throw new Error("--into needs a database URL");
    const { db, close } = await connectDatabase(url, { migrate: true });
    try {
      const r = await restoreBackup(db, data);
      console.log(`Restored ${r.rows} rows into the new database, and checked them.`);
    } finally {
      await close();
    }
  } else {
    const r = await restoreBackup(await createPgliteDatabase(), data);
    console.log(`Verified: ${r.rows} rows restore into an empty database and match the backup.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RESTORE FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
