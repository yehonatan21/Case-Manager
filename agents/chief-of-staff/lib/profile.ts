/**
 * What the database doesn't know: cash in the bank, fixed costs, payroll, targets. The owner keeps these in
 * data/business-profile.json (gitignored, so it stays on their machine); data/business-profile.example.json
 * shows the fields. Every number is optional; scripts say what they couldn't calculate without it.
 */
import fs from "node:fs";
import { z } from "zod";
import { PROFILE_FILE } from "./paths";

const amount = z.number().finite().nonnegative().nullable();

export const profileSchema = z.object({
  businessName: z.string().nullable().default(null),
  /** Cash available today, in major currency units. */
  cashOnHand: amount.default(null),
  /** Rent, software, insurance, accounting, marketing... per month. */
  monthlyFixedCosts: amount.default(null),
  /** Salaries and employer costs per month (everyone, including the owner if paid). */
  monthlyPayroll: amount.default(null),
  /** Fully loaded monthly cost of one new hire, for hiring scenarios. */
  defaultMonthlyCostPerHire: amount.default(null),
  /** Working hours in a full-time month (to turn an hourly cost into a monthly one). */
  monthlyHoursPerFte: z.number().positive().default(182),
  /** Don't recommend anything that takes runway below this. */
  minRunwayMonths: z.number().nonnegative().default(6),
  /** Open cases one handler can carry well, if the owner has a view. */
  targetOpenCasesPerHandler: z.number().positive().nullable().default(null),
  goals: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
});

export type BusinessProfile = z.infer<typeof profileSchema>;

export function loadProfile(file = PROFILE_FILE): { profile: BusinessProfile; source: string } {
  if (!fs.existsSync(file)) {
    return { profile: profileSchema.parse({}), source: "defaults (data/business-profile.json not found; copy data/business-profile.example.json)" };
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  // Keys starting with "_" are comments.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
  const parsed = profileSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`data/business-profile.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return { profile: parsed.data, source: "data/business-profile.json" };
}

/** Fixed costs plus payroll, or null when neither is set. */
export function monthlyCosts(p: BusinessProfile): number | null {
  if (p.monthlyFixedCosts === null && p.monthlyPayroll === null) return null;
  return (p.monthlyFixedCosts ?? 0) + (p.monthlyPayroll ?? 0);
}
