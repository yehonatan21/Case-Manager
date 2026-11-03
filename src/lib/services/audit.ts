import type { DbOrTx } from "../db";
import { auditLogs } from "../db/schema";

export async function audit(
  db: DbOrTx,
  entry: { actorId?: string | null; action: string; entityType: string; entityId?: string | null; details?: Record<string, unknown>; ip?: string | null },
) {
  await db.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: entry.details ?? {},
    ip: entry.ip ?? null,
  });
}
