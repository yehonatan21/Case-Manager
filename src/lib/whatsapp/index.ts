/**
 * WhatsApp messaging behind a small provider interface, so the Meta Cloud API can be swapped for another
 * provider (e.g. Twilio) without touching the rest of the app.
 *
 * Outgoing: a pre-approved template message (allowed at any time), or plain text within 24 hours of the
 * user's last message to us. Incoming: the provider's webhook, verified and normalized to `InboundEvent`s.
 */
import { createMetaProvider } from "./meta";

export type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  /** Template name as approved in WhatsApp Manager, and its language code per app locale. */
  template: string;
  templateLanguages: { he: string; en: string };
  apiUrl: string;
};

export type SendResult = { id: string };

export class WhatsAppError extends Error {
  constructor(
    message: string,
    /** Worth retrying later (rate limit, provider outage) rather than a permanent refusal. */
    readonly transient: boolean,
    readonly code?: string | number,
  ) {
    super(message);
  }
}

export type InboundMessage = {
  id: string;
  /** Sender's number, digits only. */
  from: string;
  /** The message this one replies to (one we sent), if the user used "reply". */
  contextId: string | null;
  text: string | null;
  media: { id: string; mimeType: string | null; filename: string | null; caption: string | null; kind: string } | null;
  /** Something we can't show (location, contacts, reactions…). */
  unsupported: string | null;
};

export type InboundStatus = { id: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null };

export type InboundEvent = { messages: InboundMessage[]; statuses: InboundStatus[] };

export interface WhatsAppProvider {
  /** Checks the credentials and returns the business number's display name. */
  verifyCredentials(): Promise<{ displayPhone: string | null; name: string | null }>;
  sendTemplate(to: string, language: string, params: string[]): Promise<SendResult>;
  sendText(to: string, body: string): Promise<SendResult>;
  /** Downloads a received file. */
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string | null }>;
  /** True when the raw body was signed with the app secret. */
  verifySignature(rawBody: string, headers: Headers): boolean;
  parseWebhook(payload: unknown): InboundEvent;
}

export function whatsappProvider(cfg: WhatsAppConfig): WhatsAppProvider {
  return createMetaProvider(cfg);
}

/**
 * Normalizes a phone number to international digits (972501234567). Local Israeli numbers (050-1234567)
 * get the 972 prefix; "+" and "00" prefixes are dropped. Returns null when it can't be a mobile number.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry = "972"): string | null {
  if (!input) return null;
  let s = input.trim();
  const plus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!plus && s.startsWith("00")) s = s.slice(2);
  else if (!plus && s.startsWith("0")) s = defaultCountry + s.slice(1);
  // Israeli numbers written internationally with the trunk zero (+972 050…).
  if (s.startsWith("9720")) s = "972" + s.slice(4);
  return /^[1-9]\d{9,14}$/.test(s) ? s : null;
}

/** Template parameters can't contain new lines, tabs or more than four spaces in a row, and can't be empty. */
export function templateParam(s: string, max = 900): string {
  const clean = s.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
  const cut = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  return cut || "-";
}
