import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { aiRuns, messages, type User } from "../db/schema";
import { AppError } from "../errors";
import { statusAfterClientResponse, statusWhenRequestingFromClient } from "../domain";
import { applyStatus, adminCaseLink, caseWithAccess, portalCaseLink } from "./cases";
import { addEvent } from "./events";
import { notify, staffRecipients } from "./notifications";
import { truncate } from "../utils";

export async function postMessage(
  db: Database,
  actor: User,
  caseId: string,
  input: { body: string; kind: "thread" | "internal_note"; isInfoRequest?: boolean; aiRunId?: string | null },
) {
  const body = input.body.trim();
  if (!body) throw new AppError("validation");
  return db.transaction(async (tx) => {
    const { c, access, customerUserId } = await caseWithAccess(tx, actor, caseId);
    if (!access.messages) throw new AppError("forbidden");
    if (input.kind === "internal_note" && !access.internal) throw new AppError("forbidden");
    const isInfoRequest = !access.isClient && input.kind === "thread" && !!input.isInfoRequest;

    const [m] = await tx
      .insert(messages)
      .values({ caseId: c.id, senderId: actor.id, kind: input.kind, body: body.slice(0, 10000), isInfoRequest, aiRunId: input.aiRunId ?? null })
      .returning();

    if (input.aiRunId) {
      await tx.update(aiRuns).set({ approvedById: actor.id, approvedAt: new Date() }).where(eq(aiRuns.id, input.aiRunId));
    }

    if (access.isClient) {
      const back = statusAfterClientResponse(c.status);
      await addEvent(tx, { caseId: c.id, type: "client_responded", actor, visibility: "internal" });
      if (back) await applyStatus(tx, c, back, actor, { notifyClient: false });
      await notify(tx, {
        userIds: await staffRecipients(tx, c),
        type: "new_message",
        caseId: c.id,
        vars: { number: c.number, preview: truncate(body, 140) },
        link: adminCaseLink(c.id),
      });
    } else if (input.kind === "thread") {
      if (isInfoRequest) {
        await addEvent(tx, { caseId: c.id, type: "info_requested", actor, visibility: "client" });
        const to = statusWhenRequestingFromClient(c.status);
        if (to) await applyStatus(tx, c, to, actor, { notifyClient: false });
      } else {
        await addEvent(tx, { caseId: c.id, type: "client_update", actor, visibility: "internal", data: { messageId: m!.id } });
      }
      await notify(tx, {
        userIds: [customerUserId],
        type: isInfoRequest ? "info_requested" : "new_message",
        caseId: c.id,
        vars: { number: c.number, preview: truncate(body, 140) },
        link: portalCaseLink(c.id),
      });
    }
    return m!;
  });
}
