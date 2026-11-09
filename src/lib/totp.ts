/**
 * Time-based one-time passwords (RFC 6238), as authenticator apps (Google Authenticator, Microsoft
 * Authenticator, 1Password…) make them: a shared secret, SHA-1, 30-second steps, 6 digits.
 */
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), in base32 as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

/** The code for a time step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 15;
  const n = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

/**
 * Checks a code, allowing one step either side for a phone clock that's slightly off. Returns the step it
 * matched, or null. A step at or before `lastUsedStep` is refused, so a code can't be used twice.
 */
export function verifyTotp(secret: string, code: string, opts: { now?: number; lastUsedStep?: number | null } = {}): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = currentStep(opts.now);
  for (const step of [now - 1, now, now + 1]) {
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = totpAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

/** The otpauth:// address an authenticator app reads from the QR code. */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

/** Ten single-use recovery codes like "k3f9-x2mq-7hpa", for when the phone is lost. */
export function newRecoveryCodes(n = 10): string[] {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(12);
    const s = Array.from(b, (x) => chars[x % chars.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}
