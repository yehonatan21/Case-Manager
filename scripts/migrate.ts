import "dotenv/config";

// Applies pending migrations and seeds an empty database. Uses the direct (non-pooled) connection when
// the host provides one, because connection poolers in transaction mode can't hold the migration lock.
async function main() {
  const unpooled = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  const url = unpooled || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (process.env.VERCEL && !url) {
    console.warn("\n⚠ No database connected — skipping migrations. Add a Neon database under Storage in the Vercel project, then redeploy.\n");
    return;
  }
  if (url) process.env.DATABASE_URL = url;
  process.env.AUTO_MIGRATE = "true";
  const { getDb } = await import("../src/lib/db");
  await getDb();
  console.log("Database is migrated and seeded.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
