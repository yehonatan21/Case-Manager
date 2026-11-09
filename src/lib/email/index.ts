import { env } from "../env";
import { dirOf, type Locale } from "../i18n/config";

import type { DbOrTx } from "../db";
import { readEmailConfig, type EmailConfig } from "./config";

/**
 * Resolves the sender. With an email service connected in Settings → Integrations, its sender is used.
 * Otherwise EMAIL_FROM may be "Name <address>" or a bare address; EMAIL_FROM_NAME, when set, replaces the
 * display name. Falls back to the SMTP username as the address and APP_NAME as the name.
 */
export function senderAddress(cfg?: EmailConfig | null): { name: string; address: string } {
  if (cfg) return { name: cfg.fromName || env.emailFromName || env.appName, address: cfg.fromAddress };
  const raw = env.emailFrom.trim();
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  let name = m ? m[1]!.trim() : "";
  let address = m ? m[2]!.trim() : raw;
  if (!address.includes("@") && env.smtpUrl) {
    try {
      address = decodeURIComponent(new URL(env.smtpUrl).username);
    } catch {}
  }
  if (env.emailFromName) name = env.emailFromName;
  return { name: name || env.appName, address };
}

export type EmailMessage = { to: string; subject: string; text: string; html: string };
type Transport = { sendMail: (m: Record<string, unknown>) => Promise<unknown>; verify?: () => Promise<unknown> };

let envTransport: Transport | null = null;
const appTransports = new Map<string, Transport>();

async function smtpTransport(cfg: EmailConfig): Promise<Transport> {
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.username, cfg.password]);
  let t = appTransports.get(key);
  if (!t) {
    const nodemailer = await import("nodemailer");
    t = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: !!cfg.secure, auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined, connectionTimeout: 15_000 }) as Transport;
    appTransports.clear();
    appTransports.set(key, t);
  }
  return t;
}

/** Sends one message through a connected service (also used to test a connection before it's saved). */
export async function sendWithConfig(cfg: EmailConfig, msg: EmailMessage): Promise<void> {
  const from = senderAddress(cfg);
  if (cfg.provider === "smtp") {
    const t = await smtpTransport(cfg);
    await t.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return;
  }
  const res = await fetch(`${env.resendApiUrl}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: from.name ? `${from.name.replace(/[<>"]/g, "")} <${from.address}>` : from.address, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

/**
 * Sends an email: through the service connected in Settings → Integrations when there is one (pass the
 * database), else through SMTP_URL, else "console" logs instead of sending (development).
 */
export async function sendEmail(msg: EmailMessage, db?: DbOrTx): Promise<void> {
  const cfg = db ? await readEmailConfig(db) : null;
  if (cfg) return sendWithConfig(cfg, msg);
  if (env.emailProvider === "smtp" && env.smtpUrl) {
    if (!envTransport) {
      const nodemailer = await import("nodemailer");
      envTransport = nodemailer.createTransport(env.smtpUrl) as Transport;
    }
    await envTransport.sendMail({ from: senderAddress(), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return;
  }
  if (!env.isTest) {
    console.log(`\n[email:console] To: ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n`);
  }
}

/** Whether emails really leave the server (a connected service or SMTP_URL), not just the console. */
export async function emailDelivers(db: DbOrTx): Promise<boolean> {
  return !!(await readEmailConfig(db)) || env.emailProvider !== "console";
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmail(opts: {
  locale: Locale;
  greeting: string;
  title: string;
  body: string;
  linkLabel?: string;
  link?: string | null;
  footer: string;
}): { text: string; html: string } {
  const url = opts.link ? (opts.link.startsWith("http") ? opts.link : env.appUrl + opts.link) : null;
  const text = [opts.greeting, "", opts.title, opts.body, "", url ? `${opts.linkLabel}: ${url}` : "", "", opts.footer]
    .filter((l) => l !== undefined)
    .join("\n");
  const dir = dirOf(opts.locale);
  const html = `<!doctype html><html lang="${opts.locale}" dir="${dir}"><body style="margin:0;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#1e1b4b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e2e4f0;border-radius:12px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #eef0f7;font-weight:bold;color:#3730a3">${escapeHtml(env.appName)}</td></tr>
<tr><td style="padding:28px;text-align:${dir === "rtl" ? "right" : "left"};line-height:1.6">
<p style="margin:0 0 12px">${escapeHtml(opts.greeting)}</p>
<h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(opts.title)}</h1>
<p style="margin:0 0 20px;white-space:pre-line">${escapeHtml(opts.body)}</p>
${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">${escapeHtml(opts.linkLabel ?? "")}</a>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;font-size:12px;color:#6b7280;border-top:1px solid #eef0f7">${escapeHtml(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
