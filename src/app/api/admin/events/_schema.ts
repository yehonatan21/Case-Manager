import { z } from "zod";

/** A team member's own calendar event, as the Meetings page sends it. */
export const EventBody = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allDay: z.boolean(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  video: z.boolean().optional(),
});
