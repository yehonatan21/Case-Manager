import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { getIntake } from "@/lib/services/intake";
import { listCustomerCases, listStaffCases, submitIntakeAsCase } from "@/lib/services/cases";
import { generateCaseSummary } from "@/lib/services/copilot";
import { isStaffRole } from "@/lib/domain";
import { after } from "next/server";
import { readOwnerToken } from "../intake/_owner";

const Edits = z.object({
  request_title: z.string().min(1).max(200),
  request_description: z.string().min(1).max(8000),
  customer_goal: z.string().max(2000).default(""),
  service_category: z.string().max(60),
  urgency: z.enum(["low", "normal", "high", "urgent"]),
  known_facts: z.array(z.object({ label: z.string().max(200), value: z.string().max(1000) })).max(40),
  constraints: z.array(z.string().max(500)).max(30),
  missing_information: z.array(z.string().max(500)).max(30),
  additional_notes: z.string().max(4000).optional(),
});

/** Submit a reviewed request and open a case (POST /cases in the spec). */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  const body = await readJson(req, z.object({ intakeId: z.uuid(), edits: Edits }));
  const db = await getDb();
  const session = await getIntake(db, body.intakeId, user, await readOwnerToken());
  const c = await submitIntakeAsCase(db, { user, session, edits: body.edits });
  after(async () => {
    try {
      await generateCaseSummary(db, null, c.id, c.locale);
    } catch (err) {
      console.error("[cases] background AI summary failed", err);
    }
  });
  return ok({ id: c.id, number: c.number });
});

export const GET = route(async (req) => {
  const user = await requireApiUser();
  const db = await getDb();
  if (!isStaffRole(user.role)) return ok(await listCustomerCases(db, user));
  const url = new URL(req.url);
  return ok(
    await listStaffCases(db, user, {
      status: url.searchParams.get("status") ?? undefined,
      assignee: url.searchParams.get("assignee") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    }),
  );
});

/** AI calls can take a while; allow up to a minute on serverless hosts. */
export const maxDuration = 60;
