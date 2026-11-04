/**
 * Removes the demo accounts and their sample requests from a database that was seeded with DEMO_MODE on.
 *   npm run db:remove-demo            # preview: shows what would be removed, changes nothing
 *   npm run db:remove-demo -- --apply # removes it, in one transaction
 * Uses DATABASE_URL (or PGLITE_DIR locally). Turn DEMO_MODE off first, or the next deploy seeds nothing new
 * but the demo sign-in shortcuts stay visible.
 */
import "dotenv/config";
import { getDb } from "../src/lib/db";
import { removeDemoData } from "../src/lib/services/demo-cleanup";

const apply = process.argv.includes("--apply");
getDb()
  .then(async (db) => {
    const r = await removeDemoData(db, { apply });
    console.log(JSON.stringify(r, null, 2));
    console.log(r.applied ? "Demo data removed." : r.users.length ? "Preview only. Run again with --apply to remove it." : "No demo data found.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
