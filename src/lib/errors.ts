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
  | "terms_required"
  | "invalid_transition"
  | "quote_not_editable"
  | "quote_not_sendable"
  | "quote_not_approvable"
  | "quote_expired"
  | "payment_not_allowed"
  | "already_paid"
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
  terms_required: 400,
  invalid_transition: 409,
  quote_not_editable: 409,
  quote_not_sendable: 409,
  quote_not_approvable: 409,
  quote_expired: 409,
  payment_not_allowed: 409,
  already_paid: 409,
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
