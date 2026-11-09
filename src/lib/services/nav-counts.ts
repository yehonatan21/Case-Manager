/**
 * The staff menu's counters, each for something waiting on the person: new requests to take (Incoming), their own
 * cases running late (My Work), their overdue tasks (Tasks), and conversations waiting for an answer. Only for
 * menu items the role sees, only over records the person may see, loaded together; a zero shows no counter.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { cases, type User } from "../db/schema";
import { OPEN_STATUSES } from "../domain";
import { NAV_ITEMS, type NavBadge } from "@/config/admin-navigation";
import { staffCaseScope } from "./cases";
import { myOverdueCaseCount, myOverdueTaskCount } from "./queue";
import { awaitingReplyCount } from "./conversations";

async function inboxCount(db: DbOrTx, actor: User): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(staffCaseScope(actor), or(eq(cases.status, "submitted"), and(isNull(cases.assigneeId), inArray(cases.status, OPEN_STATUSES)))));
  return r?.n ?? 0;
}

const COUNTERS: Record<NavBadge, (db: DbOrTx, actor: User) => Promise<number>> = {
  inbox: inboxCount,
  queue: myOverdueCaseCount,
  tasks: myOverdueTaskCount,
  conversations: awaitingReplyCount,
};

export async function navCounts(db: DbOrTx, actor: User): Promise<Partial<Record<NavBadge, number>>> {
  const badges = NAV_ITEMS.filter((i) => i.badge && i.roles.includes(actor.role)).map((i) => i.badge!);
  const values = await Promise.all(badges.map((b) => COUNTERS[b](db, actor).catch(() => 0)));
  return Object.fromEntries(badges.map((b, i) => [b, values[i]!]).filter(([, n]) => (n as number) > 0));
}
