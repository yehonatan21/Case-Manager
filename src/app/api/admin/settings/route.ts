import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { updateSettings } from "@/lib/services/settings";

export const PATCH = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      company: z.object({ name: z.string().max(200), email: z.string().max(200), phone: z.string().max(60) }).optional(),
      vat_rate: z.number().min(0).max(100).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      quote_validity_days: z.number().int().min(1).max(365).optional(),
      first_response_sla_hours: z.number().int().min(1).max(720).optional(),
      intake_question_limit: z.number().int().min(1).max(20).optional(),
      document_reminder_days: z.number().int().min(0).max(60).optional(),
      document_reminder_max: z.number().int().min(1).max(10).optional(),
      meeting_durations: z.array(z.number().int().min(15).max(240)).min(1).max(4).optional(),
      meeting_buffer_minutes: z.number().int().min(0).max(120).optional(),
      meeting_min_notice_hours: z.number().int().min(0).max(168).optional(),
      meeting_horizon_days: z.number().int().min(1).max(90).optional(),
      meeting_office_address: z.string().max(300).optional(),
    }),
  );
  await updateSettings(await getDb(), user, body);
  return ok();
});
