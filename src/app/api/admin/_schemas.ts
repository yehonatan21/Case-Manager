import { z } from "zod";

export const TemplateBody = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(60),
  description: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().max(300),
        description: z.string().max(2000).optional(),
        dueInDays: z.number().int().min(0).max(365).optional(),
        requiresClientAction: z.boolean().optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
      }),
    )
    .max(40),
});

export const PriceBody = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  category: z.string().max(60),
  unitPriceCents: z.number().int().min(0),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  active: z.boolean().optional(),
});
