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

  /** auto | mock | anthropic | openrouter | openai-compatible (see src/lib/ai/providers/index.ts). */
  aiProvider: str("AI_PROVIDER", "auto").trim().toLowerCase(),
  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  aiModel: str("AI_MODEL", "claude-opus-5-5"),
  /** OpenRouter (openrouter.ai): one API for many models, including free ones. */
  openrouterApiKey: str("OPENROUTER_API_KEY"),
  openrouterModel: str("OPENROUTER_MODEL", "nvidia/nemotron-3.5-super-vl:free"),
  /** Comma-separated models to try if the first is down or rate-limited. */
  openrouterFallbackModels: str("OPENROUTER_FALLBACK_MODELS", "google/gemma-4-31b-it:free")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  /**
   * "deny" (default) routes only to providers that don't store or train on prompts, as the privacy policy promises.
   * Most free models are then unavailable; "allow" lets them be used, but the privacy policy no longer holds.
   */
  openrouterDataCollection: (str("OPENROUTER_DATA_COLLECTION", "deny").trim().toLowerCase() === "allow" ? "allow" : "deny") as "allow" | "deny",
  openrouterBaseUrl: str("OPENROUTER_BASE_URL"),
  /** Any OpenAI-compatible API (OpenAI, Groq, Mistral, Together, a local Ollama...): AI_PROVIDER=openai-compatible. */
  aiBaseUrl: str("AI_BASE_URL"),
  aiApiKey: str("AI_API_KEY"),
  aiModelName: str("AI_MODEL_NAME"),
  /** Set to false for services that only support JSON mode, not JSON schemas. */
  aiJsonSchema: bool("AI_JSON_SCHEMA", true),
  aiMaxRunsPerHour: Number(str("AI_MAX_RUNS_PER_HOUR", "120")),

  emailProvider: str("EMAIL_PROVIDER", smtpUrl ? "smtp" : "console") as "console" | "smtp",
  smtpUrl,
  emailFrom: str("EMAIL_FROM", "Case Manager <no-reply@example.com>"),
  /** Sender name shown in recipients' inboxes; overrides the name part of EMAIL_FROM. */
  emailFromName: str("EMAIL_FROM_NAME").trim(),
  devMailbox: bool("DEV_MAILBOX", !isProd || demoMode),

  paymentProvider: str("PAYMENT_PROVIDER", stripeSecretKey ? "stripe" : "mock") as "mock" | "stripe",
  stripeSecretKey,
  stripeWebhookSecret: str("STRIPE_WEBHOOK_SECRET"),
  paymentWebhookSecret: str("PAYMENT_WEBHOOK_SECRET", "dev-payment-webhook-secret"),
  /** Grow (Meshulam) identifiers. Can also be entered by an admin under Payments → Connect Grow. */
  growUserId: str("GROW_USER_ID"),
  growPageCode: str("GROW_PAGE_CODE"),
  growApiKey: str("GROW_API_KEY"),
  growSandbox: bool("GROW_SANDBOX", true),
  growApiUrl: str("GROW_API_URL"),
  /** WhatsApp (Meta Cloud API). Can also be entered by an admin under Settings → Integrations. */
  whatsappPhoneNumberId: str("WHATSAPP_PHONE_NUMBER_ID").trim(),
  whatsappAccessToken: str("WHATSAPP_ACCESS_TOKEN").trim(),
  whatsappAppSecret: str("WHATSAPP_APP_SECRET").trim(),
  whatsappVerifyToken: str("WHATSAPP_VERIFY_TOKEN").trim(),
  whatsappTemplate: str("WHATSAPP_TEMPLATE", "case_update").trim(),
  /** Graph API base URL (with version). Override only for tests. */
  /** Invoicing service API base URL override (tests). */
  invoiceApiUrl: str("INVOICE_API_URL").replace(/\/+$/, ""),
  /** Resend's API base URL. Override only for tests. */
  resendApiUrl: str("RESEND_API_URL", "https://api.resend.com").replace(/\/+$/, ""),
  whatsappApiUrl: str("WHATSAPP_API_URL", "https://graph.facebook.com/v23.0").replace(/\/+$/, ""),

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
  /** "Continue with Google" sign-in (OAuth client from Google Cloud Console). */
  // Trimmed (and stripped of wrapping quotes): pasted dashboard values often carry stray whitespace.
  googleClientId: str("GOOGLE_CLIENT_ID").trim().replace(/^["']|["']$/g, ""),
  googleClientSecret: str("GOOGLE_CLIENT_SECRET").trim().replace(/^["']|["']$/g, ""),
  /** Sign-in codes per email address per 15 minutes (abuse protection). Raise only for test servers. */
  otpMaxPerEmail: Math.max(1, Number(str("OTP_MAX_PER_EMAIL", "5")) || 5),
  /** Sign-in codes per IP address per 15 minutes. Raise only for test servers. */
  otpMaxPerIp: Math.max(1, Number(str("OTP_MAX_PER_IP", "30")) || 30),
  /** Code checks per IP per 15 minutes. */
  otpVerifyMaxPerIp: Math.max(1, Number(str("OTP_VERIFY_MAX_PER_IP", "60")) || 60),
  /** Web Push keys. Optional: without them the app generates a key pair once and stores it encrypted. */
  vapidPublicKey: str("VAPID_PUBLIC_KEY"),
  vapidPrivateKey: str("VAPID_PRIVATE_KEY"),
  /** Contact for push services: mailto:you@example.com or https://your-site. Defaults to the app URL. */
  vapidSubject: str("VAPID_SUBJECT"),
  /** Extra push endpoint hosts (host:port) beyond the browser push services — for tests only. */
  pushExtraHosts: str("PUSH_EXTRA_HOSTS")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  /**
   * Native push for the iPhone/Android app (mobile/). Android goes through Firebase Cloud Messaging with a
   * service account (the JSON file's contents, raw or base64); iPhone goes straight to Apple (APNs) with a .p8
   * key. Each is optional: without it, devices on that platform simply aren't sent to.
   */
  fcmServiceAccount: str("FCM_SERVICE_ACCOUNT"),
  apnsKey: str("APNS_KEY").replace(/\\n/g, "\n"),
  apnsKeyId: str("APNS_KEY_ID"),
  apnsTeamId: str("APNS_TEAM_ID"),
  /** The iPhone app's bundle id (mobile/capacitor.config.ts). */
  apnsTopic: str("APNS_TOPIC", "app.casemanager.mobile"),
  /** "sandbox" for builds run from Xcode; "production" (default) for TestFlight and the App Store. */
  apnsEnvironment: str("APNS_ENVIRONMENT", "production") === "sandbox" ? ("sandbox" as const) : ("production" as const),
  /** Test-only overrides for the push services' addresses. */
  fcmApiUrl: str("FCM_API_URL", "https://fcm.googleapis.com"),
  fcmTokenUrl: str("FCM_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  apnsUrl: str("APNS_URL"),
  /** The app's URL scheme for returning from sign-in in the system browser (mobile/: appId). */
  appUrlScheme: str("APP_URL_SCHEME", "app.casemanager.mobile"),
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
