/**
 * Centralised, typed access to environment configuration.
 * Every integration has a safe local default so the app runs with zero setup;
 * production deployments override these via environment variables.
 */
function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Public demo mode: sign-in codes are shown on screen, demo data is seeded and a banner warns that
 * the environment is shared. Lets a fresh deployment be tried before email is configured.
 * Never enable it for real customer data.
 */
const demoMode = bool("DEMO_MODE", false);

const isVercel = !!process.env.VERCEL;

/** Public base URL: explicit APP_URL, else what the hosting platform provides. */
function publicUrl(): string {
  const explicit = str("APP_URL") || str("RENDER_EXTERNAL_URL");
  if (explicit) return explicit;
  const vercelHost = str("VERCEL_PROJECT_PRODUCTION_URL") || str("VERCEL_URL");
  if (vercelHost) return `https://${vercelHost}`;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  return "http://localhost:3000";
}

const smtpUrl = str("SMTP_URL");
// Neon / Vercel Postgres integrations use these names.
const databaseUrl = str("DATABASE_URL") || str("POSTGRES_URL");
const blobToken = str("BLOB_READ_WRITE_TOKEN");
const stripeSecretKey = str("STRIPE_SECRET_KEY");

export const env = {
  isProd,
  isVercel,
  demoMode,
  isTest: process.env.NODE_ENV === "test" || !!process.env.VITEST,
  appUrl: publicUrl().replace(/\/$/, ""),
  appName: str("APP_NAME", "Case Manager"),
  appSecret: str("APP_SECRET", "dev-insecure-secret-change-me-0123456789abcdef"),

  databaseUrl,
  /** Direct (non-pooled) connection for migrations; poolers in transaction mode break advisory locks. */
  databaseUrlUnpooled: str("DATABASE_URL_UNPOOLED") || str("POSTGRES_URL_NON_POOLING") || databaseUrl,
  pgliteDir: str("PGLITE_DIR", ".data/pglite"),
  // Serverless: migrations run once in the build step (npm run vercel-build), not on every cold start.
  autoMigrate: bool("AUTO_MIGRATE", !isVercel),
  seedDemoData: bool("SEED_DEMO_DATA", !isProd || demoMode),
  adminEmail: str("ADMIN_EMAIL", "admin@example.com").toLowerCase(),

  aiProvider: str("AI_PROVIDER", "auto") as "auto" | "anthropic" | "mock",
  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  aiModel: str("AI_MODEL", "claude-opus-5-5"),
  aiMaxRunsPerHour: Number(str("AI_MAX_RUNS_PER_HOUR", "120")),

  emailProvider: str("EMAIL_PROVIDER", smtpUrl ? "smtp" : "console") as "console" | "smtp",
  smtpUrl,
  emailFrom: str("EMAIL_FROM", "Case Manager <no-reply@example.com>"),
  devMailbox: bool("DEV_MAILBOX", !isProd || demoMode),

  paymentProvider: str("PAYMENT_PROVIDER", stripeSecretKey ? "stripe" : "mock") as "mock" | "stripe",
  stripeSecretKey,
  stripeWebhookSecret: str("STRIPE_WEBHOOK_SECRET"),
  paymentWebhookSecret: str("PAYMENT_WEBHOOK_SECRET", "dev-payment-webhook-secret"),

  // local disk by default; Vercel Blob when connected; the database when the host has no persistent disk.
  storageProvider: str("STORAGE_PROVIDER", blobToken ? "vercel-blob" : isVercel ? "database" : "local") as "local" | "s3" | "vercel-blob" | "database",
  storageDir: str("STORAGE_DIR", ".data/uploads"),
  s3Bucket: str("S3_BUCKET"),
  s3Region: str("S3_REGION", "us-east-1"),
  s3Endpoint: str("S3_ENDPOINT"),
  s3AccessKeyId: str("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: str("S3_SECRET_ACCESS_KEY"),
  maxUploadBytes: Number(str("MAX_UPLOAD_MB", "20")) * 1024 * 1024,

  clamavHost: str("CLAMAV_HOST"),
  clamavPort: Number(str("CLAMAV_PORT", "3310")),

  cronSecret: str("CRON_SECRET"),
  /** Run maintenance jobs (quote expiry, email outbox) inside the server every N minutes; 0 = off. */
  jobsIntervalMinutes: Number(str("JOBS_INTERVAL_MINUTES", "0")),
};

/** Refuse insecure production configs; warn about ones that make the app unusable. */
export function assertProductionConfig() {
  if (!env.isProd) return;
  if (env.appSecret.startsWith("dev-insecure") || env.appSecret.length < 16) {
    throw new Error("APP_SECRET must be set to a long random value in production");
  }
  if (env.paymentWebhookSecret === "dev-payment-webhook-secret" && env.paymentProvider === "mock" && !env.demoMode) {
    console.warn("[config] PAYMENT_WEBHOOK_SECRET is the development default; set it or configure Stripe.");
  }
  if (env.emailProvider === "console" && !env.demoMode) {
    console.warn("[config] No SMTP_URL configured and DEMO_MODE is off: sign-in codes are only written to the server log.");
  }
  if (env.isVercel && !env.databaseUrl) {
    console.warn("[config] No DATABASE_URL: add a Neon database under Storage in the Vercel project, then redeploy.");
  }
  if (env.demoMode) {
    console.warn("[config] DEMO_MODE is on: sign-in codes are shown on screen. Do not use with real customer data.");
  }
}
