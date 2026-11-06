/** Domain error with a stable code that the UI maps to a localized message (dictionary `errors.<code>`). */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "account_disabled"
  | "signup_required"
  | "no_account"
  | "staff_email"
  | "already_team_member"
  | "email_is_client"
  | "terms_required"
  | "invalid_transition"
  | "activation_reason_required"
  | "quote_not_editable"
  | "quote_not_sendable"
  | "quote_not_approvable"
  | "quote_expired"
  | "payment_not_allowed"
  | "already_paid"
  | "payment_provider_error"
  | "currency_not_supported"
  | "payer_name_invalid"
  | "payer_phone_invalid"
  | "whatsapp_refused"
  | "whatsapp_unavailable"
  | "whatsapp_phone_invalid"
  | "whatsapp_needs_opt_in"
  | "signature_not_pdf"
  | "signature_already_requested"
  | "signature_not_pending"
  | "signature_name_invalid"
  | "signature_outdated"
  | "signature_pdf_unsupported"
  | "category_exists"
  | "calendar_not_granted"
  | "meeting_slot_taken"
  | "meeting_limit"
  | "meeting_in_past"
  | "invoices_refused"
  | "feedback_exists"
  | "feedback_not_ready"
  | "file_too_large"
  | "file_type_not_allowed"
  | "file_infected"
  | "ai_unavailable"
  | "conflict"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  rate_limited: 429,
  invalid_code: 400,
  code_expired: 400,
  too_many_attempts: 429,
  account_disabled: 403,
  signup_required: 400,
  no_account: 404,
  staff_email: 409,
  already_team_member: 409,
  email_is_client: 409,
  terms_required: 400,
  invalid_transition: 409,
  activation_reason_required: 422,
  quote_not_editable: 409,
  quote_not_sendable: 409,
  quote_not_approvable: 409,
  quote_expired: 409,
  payment_not_allowed: 409,
  already_paid: 409,
  payment_provider_error: 502,
  currency_not_supported: 400,
  payer_name_invalid: 400,
  payer_phone_invalid: 400,
  whatsapp_refused: 400,
  whatsapp_unavailable: 400,
  whatsapp_phone_invalid: 400,
  whatsapp_needs_opt_in: 400,
  signature_not_pdf: 400,
  signature_already_requested: 409,
  signature_not_pending: 409,
  signature_name_invalid: 400,
  signature_outdated: 409,
  signature_pdf_unsupported: 400,
  category_exists: 409,
  calendar_not_granted: 400,
  meeting_slot_taken: 409,
  meeting_limit: 400,
  meeting_in_past: 400,
  invoices_refused: 400,
  feedback_exists: 409,
  feedback_not_ready: 400,
  file_too_large: 413,
  file_type_not_allowed: 415,
  file_infected: 422,
  ai_unavailable: 503,
  conflict: 409,
  server_error: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.status = STATUS[code];
  }
}

export function assert(cond: unknown, code: ErrorCode, message?: string): asserts cond {
  if (!cond) throw new AppError(code, message);
}

/** Every error code, e.g. for checking that each one has a translated message. */
export const ERROR_CODES = Object.keys(STATUS) as ErrorCode[];
