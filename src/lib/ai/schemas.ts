import { z } from "zod";

// All fields are required (nullable where optional) to fit structured-output constraints.

export const IntakeSummarySchema = z.object({
  request_title: z.string().describe("Short title, max ~10 words"),
  request_description: z.string().describe("Detailed description of the request, in the customer's language"),
  service_category: z.string().describe('Key of the best-fitting service type from the list, or "new" when none fits'),
  new_service_type: z
    .object({ name_he: z.string(), name_en: z.string() })
    .nullable()
    // Required in the JSON schema sent to the model; replies that leave it out still parse.
    .default(null)
    .describe('Only when service_category is "new": a short name (1–3 words) for the new service type, in Hebrew and English'),
  customer_goal: z.string().describe("The outcome the customer wants"),
  known_facts: z.array(z.object({ label: z.string(), value: z.string() })).describe("Only facts the customer actually stated"),
  constraints: z.array(z.string()).describe("Deadlines, budget and other constraints the customer mentioned"),
  missing_information: z.array(z.string()).describe("Details the team still needs"),
  suggested_next_questions: z.array(z.string()),
  urgency: z.enum(["low", "normal", "high", "urgent"]),
  needs_human_review: z.boolean(),
  assumptions: z.array(z.string()).describe("The assistant's own interpretation — never presented as customer facts"),
});

export const IntakeTurnSchema = z.object({
  reply: z.string().describe("Next message to the customer: brief acknowledgement plus at most ONE central question"),
  quick_replies: z.array(z.string()).describe("0-4 short suggested answers"),
  ready_for_review: z.boolean(),
  summary: IntakeSummarySchema,
});
export type IntakeTurn = z.infer<typeof IntakeTurnSchema>;

export const CaseSummarySchema = z.object({
  what_client_wants: z.string(),
  known_facts: z.array(z.object({ fact: z.string(), source_refs: z.array(z.string()).describe("Reference ids like INTAKE, M3, D1") })),
  missing_information: z.array(z.string()),
  complexities: z.array(z.string()).describe("Risks, ambiguities and dependencies"),
  recommended_next_step: z.string().describe("One operational next step"),
});
export type CaseSummaryOutput = z.infer<typeof CaseSummarySchema>;

export const QuoteDraftSchema = z.object({
  service_name: z.string(),
  scope: z.string().describe("Scope of work, phases and expected deliverables"),
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  required_documents: z.array(z.string()),
  items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      price_list_code: z.string().nullable().describe("Code from the approved price list, or null if none fits"),
    }),
  ),
  payment_terms: z.string(),
  timeline_estimate: z.string().describe("Rough estimate for staff to confirm; empty if unknown"),
  disclaimers: z.array(z.string()),
});
export type QuoteDraft = z.infer<typeof QuoteDraftSchema>;

export const TaskPlanSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      requires_client_action: z.boolean(),
      due_in_days: z.number().nullable(),
      priority: z.enum(["low", "normal", "high"]),
    }),
  ),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const TextDraftSchema = z.object({ text: z.string() });

export const DocAnalysisSchema = z.object({
  readable: z.boolean().describe("false if the document cannot be read reliably (e.g. poor scan)"),
  summary: z.string(),
  fields: z.array(z.object({ label: z.string(), value: z.string(), location: z.string().nullable(), confidence: z.enum(["low", "medium", "high"]) })),
  notes: z.string(),
});
export type DocAnalysis = z.infer<typeof DocAnalysisSchema>;

export type TextTool = "clarify_questions" | "professional" | "shorten" | "translate" | "summarize_thread" | "status_update";
