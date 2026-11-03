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

export const env = {
  isProd,
  isTest: process.env.NODE_ENV === "test" || !!process.env.VITEST,
  appUrl: str("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  appName: str("APP_NAME", "Case Manager"),
  appSecret: str("APP_SECRET", "dev-insecure-secret-change-me-0123456789abcdef"),

  databaseUrl: str("DATABASE_URL"),
  pgliteDir: str("PGLITE_DIR", ".data/pglite"),
  autoMigrate: bool("AUTO_MIGRATE", true),
  seedDemoData: bool("SEED_DEMO_DATA", !isProd),
  adminEmail: str("ADMIN_EMAIL", "admin@example.com").toLowerCase(),

  aiProvider: str("AI_PROVIDER", "auto") as "auto" | "anthropic" | "mock",
  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  aiModel: str("AI_MODEL", "claude-opus-5-5"),
  aiMaxRunsPerHour: Number(str("AI_MAX_RUNS_PER_HOUR", "120")),

  emailProvider: str("EMAIL_PROVIDER", "console") as "console" | "smtp",
  smtpUrl: str("SMTP_URL"),
  emailFrom: str("EMAIL_FROM", "Case Manager <no-reply@example.com>"),
  devMailbox: bool("DEV_MAILBOX", !isProd),

  paymentProvider: str("PAYMENT_PROVIDER", "mock") as "mock" | "stripe",
  stripeSecretKey: str("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: str("STRIPE_WEBHOOK_SECRET"),
  paymentWebhookSecret: str("PAYMENT_WEBHOOK_SECRET", "dev-payment-webhook-secret"),

  storageProvider: str("STORAGE_PROVIDER", "local") as "local" | "s3",
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
};

export function assertProductionConfig() {
  if (env.isProd && env.appSecret.startsWith("dev-insecure")) {
    throw new Error("APP_SECRET must be set in production");
  }
}
