import crypto from "node:crypto";
import { env } from "./env";

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmac(input: string, secret = env.appSecret): string {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Short-lived signed token: payload.expiry.signature */
export function signToken(payload: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${payload}.${exp}`;
  return `${Buffer.from(body).toString("base64url")}.${hmac(body)}`;
}

export function verifyToken(token: string): string | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const body = Buffer.from(b64, "base64url").toString();
  if (!safeEqual(hmac(body), sig)) return null;
  const idx = body.lastIndexOf(".");
  const payload = body.slice(0, idx);
  const exp = Number(body.slice(idx + 1));
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function fileKey(): Buffer {
  return crypto.createHash("sha256").update(`file-encryption:${env.appSecret}`).digest();
}

/** AES-256-GCM encryption for files at rest in local storage. */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", fileKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("CMv1"), iv, tag, enc]);
}

export function decryptBuffer(data: Buffer): Buffer {
  if (data.subarray(0, 4).toString() !== "CMv1") return data;
  const iv = data.subarray(4, 16);
  const tag = data.subarray(16, 32);
  const enc = data.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", fileKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
