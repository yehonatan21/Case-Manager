import { z } from "zod";
import { caseStatusEnum } from "@/lib/db/schema";
import { AUTOMATION_TRIGGERS } from "@/lib/services/automation";

export const RuleBody = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean(),
  trigger: z.enum(AUTOMATION_TRIGGERS as [string, ...string[]]),
  triggerStatus: z.enum(caseStatusEnum.enumValues).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("create_task"), title: z.string().trim().min(1).max(300), dueInDays: z.number().int().min(0).max(365).nullable().optional(), priority: z.enum(["low", "normal", "high"]).optional() }),
    z.object({ type: z.literal("notify_owner"), text: z.string().trim().min(1).max(500) }),
    z.object({ type: z.literal("message_client"), he: z.string().max(2000), en: z.string().max(2000) }),
  ]),
});
