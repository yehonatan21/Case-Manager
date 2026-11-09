/**
 * Settings → Integrations → Email: an admin connects the service that sends sign-in codes and email updates
 * (any SMTP server, e.g. Gmail, Outlook or the domain's mail host, or Resend). Connecting sends a test email
 * to the admin first, and is saved only if it arrives at the service; the password or key is stored encrypted.
 * Without a connection, SMTP_URL from the environment is used, as before.
 */
import type { DbOrTx } from "../db";
import type { User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { readEmailConfig, writeEmailConfig, type EmailConfig, type EmailProviderKind } from "../email/config";
import { renderEmail, sendWithConfig } from "../email";
import { audit } from "./audit";

export type EmailStatus = {
  connected: boolean;
  provider: EmailProviderKind | null;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  keyHint: string | null;
  fromAddress: string | null;
  fromName: string | null;
  connectedAt: string | null;
  /** What sends email when nothing is connected here. */
  fallback: "env_smtp" | "console";
};

const hint = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export async function getEmailStatus(db: DbOrTx): Promise<EmailStatus> {
  const c = await readEmailConfig(db);
  return {
    connected: !!c,
    provider: c?.provider ?? null,
    host: c?.host ?? null,
    port: c?.port ?? null,
    secure: !!c?.secure,
    username: c?.username ?? null,
    keyHint: c?.provider === "resend" && c.apiKey ? hint(c.apiKey) : null,
    fromAddress: c?.fromAddress ?? null,
    fromName: c?.fromName ?? null,
    connectedAt: c?.connectedAt ?? null,
    fallback: env.emailProvider === "smtp" && env.smtpUrl ? "env_smtp" : "console",
  };
}

export type ConnectEmailInput = {
  provider: EmailProviderKind;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  /** Empty when changing other details: the stored password or key is kept. */
  password?: string;
  apiKey?: string;
  fromAddress: string;
  fromName?: string | null;
};

function testMessage(to: string, name: string, locale: Locale) {
  const d = dictionaries[locale];
  const subject = fmt(d.emailConnect.testSubject, { app: env.appName });
  const { text, html } = renderEmail({
    locale,
    greeting: fmt(d.email.greeting, { name }),
    title: subject,
    body: d.emailConnect.testBody,
    footer: fmt(d.email.footer, { app: env.appName }),
  });
  return { to, subject, text, html };
}

/** Checks the details by sending a test email to the admin, then saves them. */
export async function connectEmail(db: DbOrTx, actor: User, input: ConnectEmailInput) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const prev = await readEmailConfig(db);
  const same = prev?.provider === input.provider ? prev : null;
  const fromAddress = input.fromAddress.trim().toLowerCase();
  if (!EMAIL.test(fromAddress)) throw new AppError("validation", "Invalid sender address");
  const fromName =
    input.fromName
      ?.trim()
      .replace(/[<>"\r\n]/g, "")
      .slice(0, 80) || null;
  let cfg: EmailConfig;
  if (input.provider === "smtp") {
    const host = (input.host ?? "").trim().toLowerCase();
    const port = Number(input.port);
    if (!HOST.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new AppError("validation", "Invalid SMTP server");
    const username = (input.username ?? "").trim();
    const password = input.password || same?.password || "";
    if (username.length > 200 || password.length > 500) throw new AppError("validation");
    cfg = {
      provider: "smtp",
      host,
      port,
      secure: input.secure ?? port === 465,
      username: username || undefined,
      password: password || undefined,
      fromAddress,
      fromName,
      connectedAt: new Date().toISOString(),
      connectedBy: actor.id,
    };
  } else if (input.provider === "resend") {
    const apiKey = (input.apiKey ?? "").trim() || same?.apiKey || "";
    if (!/^re_[\w-]{8,200}$/.test(apiKey)) throw new AppError("validation", "Invalid Resend API key");
    cfg = {
      provider: "resend",
      apiKey,
      fromAddress,
      fromName,
      connectedAt: new Date().toISOString(),
      connectedBy: actor.id,
    };
  } else throw new AppError("validation");
  try {
    await sendWithConfig(cfg, testMessage(actor.email, actor.name, (actor.locale as Locale) ?? "he"));
  } catch (err) {
    throw new AppError("email_refused", `The email service refused: ${(err as Error).message}`.slice(0, 400));
  }
  await writeEmailConfig(db, cfg);
  await audit(db, {
    actorId: actor.id,
    action: "email.connect",
    entityType: "settings",
    details: { provider: cfg.provider, host: cfg.host ?? null, fromAddress },
  });
}

/** Sends a test email through the connected service to the admin. */
export async function sendTestEmail(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const cfg = await readEmailConfig(db);
  if (!cfg) throw new AppError("validation", "No email service is connected");
  try {
    await sendWithConfig(cfg, testMessage(actor.email, actor.name, (actor.locale as Locale) ?? "he"));
  } catch (err) {
    throw new AppError("email_refused", `The email service refused: ${(err as Error).message}`.slice(0, 400));
  }
}

export async function disconnectEmail(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  await writeEmailConfig(db, null);
  await audit(db, {
    actorId: actor.id,
    action: "email.disconnect",
    entityType: "settings",
  });
}
