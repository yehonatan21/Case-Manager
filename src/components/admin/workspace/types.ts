import type { CaseAiSummary, CaseStatus, IntakeSummary, QuoteStatus, TaskStatus, Urgency, UserRole } from "@/lib/db/schema";
import type { TimelineEvent } from "@/components/app/timeline";
import type { ThreadMessage } from "@/components/case/message-thread";
import type { Doc } from "@/components/case/documents-panel";
import type { CaseAccess } from "@/lib/auth/permissions";

export type WorkspaceTask = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  status: TaskStatus;
  priority: "low" | "normal" | "high";
  requiresClientAction: boolean;
};

export type WorkspaceQuote = {
  id: string;
  version: number;
  status: QuoteStatus;
  expired: boolean;
  serviceName: string;
  totalCents: number;
  currency: string;
  sentAt: Date | string | null;
  approvedAt: Date | string | null;
  updatedAt: Date | string;
};

export type WorkspacePayment = { id: string; amountCents: number; currency: string; status: string; provider: string; createdAt: Date | string; paidAt: Date | string | null };

export type WorkspaceData = {
  id: string;
  number: string;
  title: string;
  description: string;
  goal: string;
  status: CaseStatus;
  urgency: Urgency;
  serviceCategory: string;
  createdAt: Date | string;
  assigneeId: string | null;
  intakeSummary: IntakeSummary | null;
  aiSummary: CaseAiSummary | null;
  customer: { name: string; email: string; phone: string | null; type: string; organization: string | null; customerId: string; aiConsent: boolean } | null;
  /** The client's rating, once the case is completed. */
  feedback?: { rating: number; comment: string | null; createdAt: Date | string } | null;
  access: CaseAccess;
  events: TimelineEvent[];
  messages: ThreadMessage[];
  documents: Doc[];
  tasks: WorkspaceTask[];
  quotes: WorkspaceQuote[];
  payments: WorkspacePayment[];
  recommendations: ("ask_client" | "prepare_quote" | "create_tasks")[];
};

export type StaffOption = { id: string; name: string; role: UserRole };
export type TemplateOption = { id: string; name: string; category: string; documents?: { title: string; note?: string; required?: boolean }[] };
