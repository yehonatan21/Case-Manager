import type { CaseStatus, UserRole } from "./db/schema";

/** Preliminary service categories the intake assistant may suggest. "other" is always valid. */
export const SERVICE_CATEGORIES = [
  "immigration_visa",
  "citizenship",
  "relocation",
  "business_setup",
  "legal_consulting",
  "tax_finance",
  "real_estate",
  "documents_translation",
  "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export function normalizeCategory(c: string | null | undefined): ServiceCategory {
  return (SERVICE_CATEGORIES as readonly string[]).includes(c ?? "") ? (c as ServiceCategory) : "other";
}

export const STAFF_ROLES: UserRole[] = ["admin", "case_manager", "staff", "finance"];

export function isStaffRole(role: UserRole): boolean {
  return role !== "customer";
}

// ---------- Case status machine ----------

/** Status labels the customer sees — deliberately simpler than the internal states. */
export type ClientStatus =
  | "received"
  | "in_review"
  | "awaiting_your_info"
  | "quote_ready"
  | "awaiting_payment"
  | "in_progress"
  | "awaiting_your_action"
  | "completed"
  | "closed"
  | "cancelled"
  | "declined";

export const CLIENT_STATUS: Record<CaseStatus, ClientStatus> = {
  draft: "received",
  submitted: "received",
  under_review: "in_review",
  awaiting_information: "awaiting_your_info",
  quote_preparation: "in_review",
  quote_sent: "quote_ready",
  awaiting_payment: "awaiting_payment",
  active: "in_progress",
  awaiting_client: "awaiting_your_action",
  completed: "completed",
  closed: "closed",
  cancelled: "cancelled",
  declined: "declined",
};

/** The main progress track shown to customers. */
export const CLIENT_TRACK = ["received", "in_review", "quote_ready", "awaiting_payment", "in_progress", "completed"] as const;

export function clientTrackIndex(status: CaseStatus): number {
  switch (status) {
    case "draft":
    case "submitted":
      return 0;
    case "under_review":
    case "awaiting_information":
    case "quote_preparation":
      return 1;
    case "quote_sent":
      return 2;
    case "awaiting_payment":
      return 3;
    case "active":
    case "awaiting_client":
      return 4;
    case "completed":
    case "closed":
      return 5;
    default:
      return -1;
  }
}

/**
 * Transitions a staff member may trigger manually.
 * quote_sent / awaiting_payment / (awaiting_payment → active) are system-driven:
 * they only happen by sending a quote, a customer approving it, or a verified payment.
 */
export const MANUAL_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["under_review", "awaiting_information", "quote_preparation", "declined", "cancelled"],
  under_review: ["awaiting_information", "quote_preparation", "active", "declined", "cancelled"],
  awaiting_information: ["under_review", "quote_preparation", "declined", "cancelled"],
  quote_preparation: ["under_review", "awaiting_information", "active", "declined", "cancelled"],
  quote_sent: ["quote_preparation", "under_review", "declined", "cancelled"],
  awaiting_payment: ["quote_preparation", "cancelled"],
  active: ["awaiting_client", "completed", "cancelled"],
  awaiting_client: ["active", "completed", "cancelled"],
  completed: ["closed", "active"],
  closed: ["active"],
  cancelled: ["under_review"],
  declined: ["under_review"],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return MANUAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export const OPEN_STATUSES: CaseStatus[] = [
  "submitted",
  "under_review",
  "awaiting_information",
  "quote_preparation",
  "quote_sent",
  "awaiting_payment",
  "active",
  "awaiting_client",
];

export const PRE_WORK_STATUSES: CaseStatus[] = ["submitted", "under_review", "awaiting_information", "quote_preparation"];

/** Status to return to once the customer responds to a request for information. */
export function statusAfterClientResponse(status: CaseStatus): CaseStatus | null {
  if (status === "awaiting_information") return "under_review";
  if (status === "awaiting_client") return "active";
  return null;
}

/** Status to move to when staff asks the customer for something. */
export function statusWhenRequestingFromClient(status: CaseStatus): CaseStatus | null {
  if (status === "submitted" || status === "under_review" || status === "quote_preparation") return "awaiting_information";
  if (status === "active") return "awaiting_client";
  return null;
}

// ---------- Uploads ----------

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
  "image/gif": ["gif"],
  "text/plain": ["txt"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

export const ACCEPT_ATTRIBUTE = Object.values(ALLOWED_UPLOAD_TYPES)
  .flat()
  .map((e) => "." + e)
  .join(",");
