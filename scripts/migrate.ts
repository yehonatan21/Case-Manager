import "dotenv/config";
import { getDb } from "../src/lib/db";

// getDb() applies pending migrations (with an advisory lock on Postgres) and seeds an empty database.
getDb()
  .then(() => {
    console.log("Database is migrated and seeded.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
