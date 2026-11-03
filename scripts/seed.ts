import "dotenv/config";
import { getDb } from "../src/lib/db";
import { seedDemo } from "../src/lib/db/seed";

// Base data is seeded automatically on first start. `npm run db:seed -- --demo` adds demo data.
getDb()
  .then(async (db) => {
    if (process.argv.includes("--demo")) {
      await seedDemo(db);
      console.log("Demo data inserted.");
    } else {
      console.log("Base data ensured. Pass --demo to insert demo data.");
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
