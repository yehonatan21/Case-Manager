import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { settings } from "../db/schema";
import { decryptBuffer, encryptBuffer } from "../crypto";

/**
 * The email service an admin connected under Settings → Integrations, stored encrypted in settings. When none is
 * connected, the SMTP_URL environment variable (or the console, in development) is used, as before.
 */
export const EMAIL_SETTINGS_KEY = "integrations.email";

export type EmailProviderKind = "smtp" | "resend";
export type EmailConfig = {
  provider: EmailProviderKind;
  /** SMTP: host, port, TLS from the start (465) or STARTTLS, and the account. */
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  /** Resend: the API key. */
  apiKey?: string;
  fromAddress: string;
  fromName: string | null;
  connectedAt: string;
  connectedBy: string;
};

export async function readEmailConfig(db: DbOrTx): Promise<EmailConfig | null> {
  // Read each time (one small row): pages and API routes are bundled separately, so an in-memory cache could
  // keep showing an old connection after it changed.
  const [row] = await db.select().from(settings).where(eq(settings.key, EMAIL_SETTINGS_KEY));
  const enc = (row?.value as { enc?: string } | undefined)?.enc;
  let value: EmailConfig | null = null;
  if (enc) {
    try {
      value = JSON.parse(decryptBuffer(Buffer.from(enc, "base64")).toString("utf8")) as EmailConfig;
    } catch (err) {
      console.error("[email] the stored email connection can't be decrypted", err);
    }
  }
  return value;
}

export async function writeEmailConfig(db: DbOrTx, value: EmailConfig | null) {
  if (!value) await db.delete(settings).where(eq(settings.key, EMAIL_SETTINGS_KEY));
  else {
    const enc = encryptBuffer(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
    await db
      .insert(settings)
      .values({
        key: EMAIL_SETTINGS_KEY,
        value: { enc },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: { enc }, updatedAt: new Date() },
      });
  }
}
