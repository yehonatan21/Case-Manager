import type { User, UserRole } from "../db/schema";

export type CaseAccessInput = {
  user: Pick<User, "id" | "role">;
  caseAssigneeId: string | null;
  caseCustomerUserId: string;
  isTaskAssignee?: boolean;
};

export type CaseAccess = {
  view: boolean;
  /** Change status, assign, create tasks, publish client updates. */
  edit: boolean;
  messages: boolean;
  internal: boolean;
  documents: boolean;
  viewQuotes: boolean;
  manageQuotes: boolean;
  assign: boolean;
  isClient: boolean;
};

const NONE: CaseAccess = {
  view: false,
  edit: false,
  messages: false,
  internal: false,
  documents: false,
  viewQuotes: false,
  manageQuotes: false,
  assign: false,
  isClient: false,
};

/** Server-side authorization for a single case. Role + ownership/assignment. */
export function caseAccess({ user, caseAssigneeId, caseCustomerUserId, isTaskAssignee = false }: CaseAccessInput): CaseAccess {
  const assigned = caseAssigneeId === user.id;
  switch (user.role) {
    case "admin":
      return { view: true, edit: true, messages: true, internal: true, documents: true, viewQuotes: true, manageQuotes: true, assign: true, isClient: false };
    case "case_manager": {
      const ok = assigned || caseAssigneeId === null || isTaskAssignee;
      return {
        view: ok,
        edit: ok,
        messages: ok,
        internal: ok,
        documents: ok,
        viewQuotes: ok,
        manageQuotes: assigned || caseAssigneeId === null,
        assign: ok,
        isClient: false,
      };
    }
    case "staff": {
      const ok = assigned || isTaskAssignee;
      return { view: ok, edit: ok, messages: ok, internal: ok, documents: ok, viewQuotes: ok, manageQuotes: false, assign: false, isClient: false };
    }
    case "finance":
      // Finance sees quotes and payments only — no automatic access to sensitive documents or messages.
      return { ...NONE, view: true, viewQuotes: true };
    case "customer": {
      const own = caseCustomerUserId === user.id;
      return { ...NONE, view: own, messages: own, documents: own, viewQuotes: own, isClient: own };
    }
    default:
      return NONE;
  }
}

export function canManageSettings(role: UserRole) {
  return role === "admin";
}

export function canSeeInbox(role: UserRole) {
  return role === "admin" || role === "case_manager";
}

export function canSeeAllQuotes(role: UserRole) {
  return role === "admin" || role === "finance" || role === "case_manager";
}

export function canSeePayments(role: UserRole) {
  return role === "admin" || role === "finance";
}

export function canSeeCustomers(role: UserRole) {
  return role === "admin" || role === "case_manager";
}

/** Opening a case on a client's behalf (e.g. after a phone call). */
export function canCreateCasesForClients(role: UserRole) {
  return role === "admin" || role === "case_manager";
}
