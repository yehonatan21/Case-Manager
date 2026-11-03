import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { caseActivityStamp, caseWithAccess, listCustomerCases } from "@/lib/services/cases";
import { unreadCount } from "@/lib/services/notifications";
import { isStaffRole } from "@/lib/domain";
import { sql } from "drizzle-orm";
import { caseEvents } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: pushes an "update" whenever something the viewer can see changes
 * (case events, messages, documents, notifications). The client refreshes its data on each update
 * and falls back to periodic refresh when the stream drops.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const db = await getDb();
  const caseId = new URL(req.url).searchParams.get("case");
  const staff = isStaffRole(user.role);
  let caseIds: string[] = [];
  if (caseId) {
    try {
      const { access } = await caseWithAccess(db, user, caseId);
      caseIds = [caseId];
      if (!access.view) return new Response("not found", { status: 404 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  } else if (!staff) {
    caseIds = (await listCustomerCases(db, user)).map((c) => c.id);
  }

  const stamp = async () => {
    const n = await unreadCount(db, user);
    if (caseIds.length) return `${n}|${await caseActivityStamp(db, caseIds, staff)}`;
    if (staff) {
      const [r] = await db.select({ t: sql<string>`coalesce(max(${caseEvents.createdAt})::text, '0')` }).from(caseEvents);
      return `${n}|${r?.t}`;
    }
    return String(n);
  };

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      let last = await stamp();
      let ticks = 0;
      controller.enqueue(encoder.encode(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`));
      timer = setInterval(async () => {
        try {
          const now = await stamp();
          if (now !== last) {
            last = now;
            controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`));
          } else if (++ticks % 10 === 0) {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          }
        } catch {
          clearInterval(timer);
          try {
            controller.close();
          } catch {}
        }
      }, 2000);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
