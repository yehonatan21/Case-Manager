import "dotenv/config";
import { getDb } from "../src/lib/db";
import { runJobs } from "../src/lib/services/jobs";

getDb()
  .then(async (db) => {
    console.log(await runJobs(db));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
