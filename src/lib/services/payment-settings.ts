import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { settings, type User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { decryptBuffer, encryptBuffer } from "../crypto";
import type { GrowConfig } from "../payments/grow";
import { audit } from "./audit";

/** Stored encrypted (AES-256-GCM with the app key) so the identifiers never sit in the database in plain text. */
const GROW_KEY = "payments.grow";

type StoredGrow = { userId: string; pageCode: string; apiKey: string | null; sandbox: boolean; connectedAt: string; connectedBy: string };

export type PaymentProviderName = "mock" | "stripe" | "grow";

export type PaymentProviderStatus = {
  active: PaymentProviderName;
  grow: { connected: boolean; source: "settings" | "env" | null; sandbox: boolean; userIdHint: string | null; pageCodeHint: string | null; connectedAt: string | null };
};

const hint = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);

async function readStored(db: DbOrTx): Promise<StoredGrow | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, GROW_KEY));
  const enc = (row?.value as { enc?: string } | undefined)?.enc;
  if (!enc) return null;
  try {
    return JSON.parse(decryptBuffer(Buffer.from(enc, "base64")).toString("utf8")) as StoredGrow;
  } catch (err) {
    // APP_SECRET changed since the connection was saved: treat as not connected rather than crash checkout.
    console.error("[payments] stored Grow connection can't be decrypted", err);
    return null;
  }
}

/** Grow identifiers from the admin's connection, else from GROW_* environment variables. */
export async function getGrowConfig(db: DbOrTx): Promise<(GrowConfig & { source: "settings" | "env" }) | null> {
  const stored = await readStored(db);
  if (stored) return { userId: stored.userId, pageCode: stored.pageCode, apiKey: stored.apiKey, sandbox: stored.sandbox, baseUrl: env.growApiUrl || null, source: "settings" };
  if (env.growUserId && env.growPageCode) {
    return { userId: env.growUserId, pageCode: env.growPageCode, apiKey: env.growApiKey || null, sandbox: env.growSandbox, baseUrl: env.growApiUrl || null, source: "env" };
  }
  return null;
}

/** Grow, once connected, takes over checkout; otherwise PAYMENT_PROVIDER (Stripe or the local simulator). */
export async function activePaymentProvider(db: DbOrTx): Promise<PaymentProviderName> {
  return (await getGrowConfig(db)) ? "grow" : env.paymentProvider;
}

export async function getPaymentProviderStatus(db: DbOrTx): Promise<PaymentProviderStatus> {
  const cfg = await getGrowConfig(db);
  const stored = cfg?.source === "settings" ? await readStored(db) : null;
  return {
    active: cfg ? "grow" : env.paymentProvider,
    grow: {
      connected: !!cfg,
      source: cfg?.source ?? null,
      sandbox: cfg?.sandbox ?? true,
      userIdHint: cfg ? hint(cfg.userId) : null,
      pageCodeHint: cfg ? hint(cfg.pageCode) : null,
      connectedAt: stored?.connectedAt ?? null,
    },
  };
}

const ID = /^[A-Za-z0-9]{4,64}$/;

export async function connectGrow(db: DbOrTx, actor: User, input: { userId: string; pageCode: string; apiKey?: string | null; sandbox: boolean }) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const userId = input.userId.trim();
  const pageCode = input.pageCode.trim();
  const apiKey = input.apiKey?.trim() || null;
  if (!ID.test(userId) || !ID.test(pageCode) || (apiKey && !ID.test(apiKey))) throw new AppError("validation", "Grow identifiers are letters and digits only");
  const value: StoredGrow = { userId, pageCode, apiKey, sandbox: input.sandbox, connectedAt: new Date().toISOString(), connectedBy: actor.id };
  const enc = encryptBuffer(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
  await db
    .insert(settings)
    .values({ key: GROW_KEY, value: { enc }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: { enc }, updatedAt: new Date() } });
  // Never log the identifiers themselves.
  await audit(db, { actorId: actor.id, action: "payments.grow_connect", entityType: "settings", details: { sandbox: input.sandbox, userIdHint: hint(userId) } });
}

export async function disconnectGrow(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  await db.delete(settings).where(eq(settings.key, GROW_KEY));
  await audit(db, { actorId: actor.id, action: "payments.grow_disconnect", entityType: "settings" });
}
