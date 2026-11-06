import {
  customType,
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  date,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

/*
 * Data model for the MVP.
 *
 * Multi-tenancy: the MVP serves a single operator. Every business entity is keyed by
 * its own id (never by "the admin user"), so a `tenant_id` column can be added to the
 * top-level tables (users, customers, organizations, cases, settings, templates,
 * price_list_items) later without restructuring relationships.
 */

// ---------- Enums ----------

export const userRoleEnum = pgEnum("user_role", [
  "customer",
  "admin",
  "case_manager",
  "staff",
  "finance",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "invited", "disabled"]);

export const customerTypeEnum = pgEnum("customer_type", ["private", "business", "company", "other"]);

export const caseStatusEnum = pgEnum("case_status", [
  "draft",
  "submitted",
  "under_review",
  "awaiting_information",
  "quote_preparation",
  "quote_sent",
  "awaiting_payment",
  "active",
  "awaiting_client",
  "completed",
  "closed",
  "cancelled",
  "declined",
]);

export const urgencyEnum = pgEnum("urgency", ["low", "normal", "high", "urgent"]);

export const intakeStatusEnum = pgEnum("intake_status", ["active", "submitted", "abandoned"]);

export const eventVisibilityEnum = pgEnum("event_visibility", ["client", "internal"]);

export const actorKindEnum = pgEnum("actor_kind", ["customer", "staff", "system", "ai"]);

export const messageKindEnum = pgEnum("message_kind", ["thread", "internal_note"]);

export const documentStatusEnum = pgEnum("document_status", [
  "requested",
  "uploaded",
  "in_review",
  "approved",
  "needs_new_version",
]);

export const signatureStatusEnum = pgEnum("signature_status", ["requested", "signed", "cancelled"]);

export const meetingStatusEnum = pgEnum("meeting_status", ["scheduled", "cancelled"]);
export const meetingModeEnum = pgEnum("meeting_mode", ["video", "phone", "office"]);

export const invoiceStatusEnum = pgEnum("invoice_status", ["pending", "issued", "failed"]);

export const scanStatusEnum = pgEnum("scan_status", ["pending", "clean", "infected", "skipped", "error"]);

export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "waiting", "done", "cancelled"]);

export const priorityEnum = pgEnum("priority", ["low", "normal", "high"]);

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "clarification_requested",
  "approved",
  "declined",
  "expired",
  "superseded",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
]);

export const aiRunStatusEnum = pgEnum("ai_run_status", ["ok", "error", "fallback"]);

export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "email", "push", "whatsapp"]);

export const notificationStatusEnum = pgEnum("notification_status", ["pending", "sent", "failed", "read"]);

// ---------- Shared JSON types ----------

export type Locale = "he" | "en";

export type IntakeChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  at: string;
  quickReplies?: string[];
  skipped?: boolean;
  attachmentIds?: string[];
  /** Question id (offline engine) — lets the engine pair questions with answers. */
  qid?: string;
};

export type IntakeSummary = {
  request_title: string;
  request_description: string;
  service_category: string;
  customer_goal: string;
  known_facts: { label: string; value: string }[];
  constraints: string[];
  missing_information: string[];
  suggested_next_questions: string[];
  urgency: "low" | "normal" | "high" | "urgent";
  needs_human_review: boolean;
  assumptions: string[];
  additional_notes?: string;
};

export type CaseAiSummary = {
  what_client_wants: string;
  known_facts: { fact: string; sources: { kind: "intake" | "message" | "document"; id: string | null }[] }[];
  missing_information: string[];
  complexities: string[];
  recommended_next_step: string;
  generated_at: string;
  provider: string;
};

export type EventData = Record<string, string | number | boolean | null | undefined>;

/** A document a service usually needs from the client (part of a service template's checklist). */
export type ServiceTemplateDocument = {
  title: string;
  note?: string;
  /** Optional documents are requested too, but don't count toward "all required documents provided". */
  required?: boolean;
};

export type ServiceTemplateTask = {
  title: string;
  description?: string;
  dueInDays?: number;
  requiresClientAction?: boolean;
  priority?: "low" | "normal" | "high";
  /** Index (in the template's stages) of the stage this task belongs to. */
  stage?: number;
  /** Index (in the template's tasks) of a task that must be done first. */
  after?: number;
};

/** A stage of a service's work plan; applying the template creates a milestone per stage. */
export type ServiceTemplateStage = {
  title: string;
  /** Target, in days from the day the plan is applied (cumulative, not per stage). */
  dueInDays?: number;
  /** Clients see the stage and its progress on their case page. */
  clientVisible?: boolean;
};

export type AutomationTrigger = "documents_complete" | "quote_approved" | "payment_succeeded" | "status_changed" | "milestone_completed" | "case_submitted";
export type AutomationAction =
  | { type: "create_task"; title: string; dueInDays?: number | null; priority?: "low" | "normal" | "high" }
  | { type: "notify_owner"; text: string }
  | { type: "message_client"; he: string; en: string };

// ---------- Tables ----------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  businessId: text("business_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    role: userRoleEnum("role").notNull().default("customer"),
    status: userStatusEnum("status").notNull().default("active"),
    locale: text("locale").$type<Locale>().notNull().default("he"),
    emailNotifications: boolean("email_notifications").notNull().default(true),
    /** WhatsApp number in international format, digits only (972501234567). Set when the user opts in. */
    whatsappPhone: text("whatsapp_phone"),
    /** When the user agreed to get updates on WhatsApp. WhatsApp requires an opt-in. */
    whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
    /** Last message from this user on WhatsApp: within 24 hours, updates can go as plain text instead of a template. */
    whatsappLastInboundAt: timestamp("whatsapp_last_inbound_at", { withTimezone: true }),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    aiConsentAt: timestamp("ai_consent_at", { withTimezone: true }),
    /** The user chose not to allow AI (at registration or later). Unset with no consent = never asked (e.g. an account the team opened). */
    aiConsentDeclinedAt: timestamp("ai_consent_declined_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), index("users_whatsapp_idx").on(t.whatsappPhone)],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: customerTypeEnum("type").notNull().default("private"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customers_user_idx").on(t.userId)],
);

export const authCodes = pgTable(
  "auth_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_codes_email_idx").on(t.email, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export const intakeSessions = pgTable("intake_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerTokenHash: text("owner_token_hash"),
  userId: uuid("user_id").references(() => users.id),
  locale: text("locale").$type<Locale>().notNull().default("he"),
  status: intakeStatusEnum("status").notNull().default("active"),
  mode: text("mode").$type<"chat" | "manual">().notNull().default("chat"),
  messages: jsonb("messages").$type<IntakeChatMessage[]>().notNull().default([]),
  summary: jsonb("summary").$type<IntakeSummary | null>(),
  summaryVersion: integer("summary_version").notNull().default(0),
  questionCount: integer("question_count").notNull().default(0),
  questionLimit: integer("question_limit").notNull().default(7),
  readyForReview: boolean("ready_for_review").notNull().default(false),
  aiFailed: boolean("ai_failed").notNull().default(false),
  caseId: uuid("case_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const caseCounters = pgTable("case_counters", {
  year: integer("year").primaryKey(),
  value: integer("value").notNull().default(0),
});

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    goal: text("goal").notNull().default(""),
    serviceCategory: text("service_category").notNull().default("other"),
    status: caseStatusEnum("status").notNull().default("submitted"),
    urgency: urgencyEnum("urgency").notNull().default("normal"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    intakeSessionId: uuid("intake_session_id"),
    intakeSummary: jsonb("intake_summary").$type<IntakeSummary | null>(),
    aiSummary: jsonb("ai_summary").$type<CaseAiSummary | null>(),
    locale: text("locale").$type<Locale>().notNull().default("he"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    lastClientActivityAt: timestamp("last_client_activity_at", { withTimezone: true }),
    lastStaffActivityAt: timestamp("last_staff_activity_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** The case's deadline (a filing date, a date the client needs it by). Team only. */
    dueDate: date("due_date", { mode: "string" }),
    /** The day the handler was last reminded about the deadline, so it's once a day. */
    dueRemindedOn: date("due_reminded_on", { mode: "string" }),
    /** Set while the case waits on someone outside (an authority, a court, another office). */
    waitingOnThirdParty: boolean("waiting_on_third_party").notNull().default(false),
    /** Who or what it waits for, e.g. "Population Authority". Team only. */
    waitingNote: text("waiting_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cases_number_idx").on(t.number),
    index("cases_due_idx").on(t.dueDate),
    index("cases_customer_idx").on(t.customerId),
    index("cases_status_idx").on(t.status),
    index("cases_assignee_idx").on(t.assigneeId),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    actorKind: actorKindEnum("actor_kind").notNull().default("system"),
    visibility: eventVisibilityEnum("visibility").notNull().default("internal"),
    data: jsonb("data").$type<EventData>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("case_events_case_idx").on(t.caseId, t.createdAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id),
    kind: messageKindEnum("kind").notNull().default("thread"),
    body: text("body").notNull(),
    isInfoRequest: boolean("is_info_request").notNull().default(false),
    aiRunId: uuid("ai_run_id"),
    /** Where the message came from when not the app itself ("whatsapp"). */
    via: text("via"),
    /** The provider's message id, so a webhook delivered twice adds the message once. */
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_case_idx").on(t.caseId, t.createdAt), uniqueIndex("messages_external_idx").on(t.externalId)],
);

export const caseReads = pgTable(
  "case_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.caseId] })],
);

/** A document "slot" — either requested by staff (no file yet) or created by an upload. */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    intakeSessionId: uuid("intake_session_id"),
    messageId: uuid("message_id"),
    title: text("title").notNull(),
    status: documentStatusEnum("status").notNull().default("uploaded"),
    visibility: eventVisibilityEnum("visibility").notNull().default("client"),
    requestNote: text("request_note"),
    reviewNote: text("review_note"),
    requestedById: uuid("requested_by_id").references(() => users.id),
    createdById: uuid("created_by_id").references(() => users.id),
    currentVersion: integer("current_version").notNull().default(0),
    /** For requested documents: does the client have to provide it (counts toward checklist progress)? */
    required: boolean("required").notNull().default(true),
    /** Automatic reminders sent to the client for this request, and when the last one went out. */
    reminderCount: integer("reminder_count").notNull().default(0),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    aiAnalysis: jsonb("ai_analysis").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_case_idx").on(t.caseId)],
);

export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    scanStatus: scanStatusEnum("scan_status").notNull().default("pending"),
    uploadedById: uuid("uploaded_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_files_doc_idx").on(t.documentId)],
);

/**
 * The document issued for a payment: a tax document from the connected invoicing service (e.g. Green Invoice's
 * חשבונית מס קבלה), or, with none connected, the app's own payment confirmation (not a tax document).
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    /** "greeninvoice", or "confirmation" for the built-in payment confirmation. */
    provider: text("provider").notNull(),
    /** The provider's document type code (e.g. 320 = חשבונית מס קבלה, 400 = קבלה). */
    documentType: text("document_type"),
    status: invoiceStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    number: text("number"),
    externalId: text("external_id"),
    url: text("url"),
    /** The PDF saved to the case's documents. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_payment_idx").on(t.paymentId), index("invoices_status_idx").on(t.status)],
);

/** A client's rating of a completed case (once per case). */
export const caseFeedback = pgTable(
  "case_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The team member who handled the case when it was rated. */
    staffId: uuid("staff_id").references(() => users.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("case_feedback_case_idx").on(t.caseId)],
);

/** Weekly working hours, in the business time zone: day 0 = Sunday … 6 = Saturday. */
export type WeeklyHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", { start: string; end: string }[]>;

/** When a team member can be booked for meetings. */
export const staffAvailability = pgTable("staff_availability", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Clients can book this person. */
  bookable: boolean("bookable").notNull().default(true),
  weekly: jsonb("weekly").$type<WeeklyHours>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A meeting between a team member and the client of a case. */
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => users.id),
    clientUserId: uuid("client_user_id").references(() => users.id),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    mode: meetingModeEnum("mode").notNull().default("video"),
    status: meetingStatusEnum("status").notNull().default("scheduled"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** Reminders already sent (a day before, and an hour before). */
    remindedDayAt: timestamp("reminded_day_at", { withTimezone: true }),
    remindedHourAt: timestamp("reminded_hour_at", { withTimezone: true }),
    /** The event in the team member's connected calendar, and its video link. */
    externalEventId: text("external_event_id"),
    meetUrl: text("meet_url"),
    /** Bumped on every change, so calendar apps update the .ics event instead of adding a copy. */
    sequence: integer("sequence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meetings_case_idx").on(t.caseId), index("meetings_staff_idx").on(t.staffId, t.startAt)],
);

/** A team member's connected calendar (Google). Tokens are stored encrypted. */
export const calendarConnections = pgTable("calendar_connections", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"google">().notNull().default("google"),
  /** AES-256-GCM (app key) of { refreshToken }. */
  enc: text("enc").notNull(),
  accountEmail: text("account_email"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
});

/**
 * Service types beyond the built-in ones (SERVICE_CATEGORIES): added by an admin, or proposed by the intake AI
 * when no existing type fits a request (e.g. insurance claims, lawsuits). Admins can rename or hide them.
 */
export const serviceCategories = pgTable("service_categories", {
  key: text("key").primaryKey(),
  nameHe: text("name_he").notNull(),
  nameEn: text("name_en").notNull(),
  createdByAi: boolean("created_by_ai").notNull().default(false),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An electronic signature: requested by staff on a PDF document (then signed by the client), or made by the
 * client when approving a quote. Signing stores a new file version: the original stamped on every page plus a
 * certificate page. The record keeps the evidence (who, when, IP, device, method, fingerprints).
 */
export const signatures = pgTable(
  "signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    /** The document to sign, or (for a quote) the document the signed quote PDF was saved as. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id"),
    status: signatureStatusEnum("status").notNull().default("requested"),
    note: text("note"),
    requestedById: uuid("requested_by_id").references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** The file version that has to be signed (the request is for exactly this content). */
    fileVersion: integer("file_version"),
    signerId: uuid("signer_id").references(() => users.id),
    signerName: text("signer_name"),
    signerEmail: text("signer_email"),
    method: text("method").$type<"typed" | "drawn">(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    originalSha256: text("original_sha256"),
    signedSha256: text("signed_sha256"),
    signedFileId: uuid("signed_file_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signatures_case_idx").on(t.caseId), index("signatures_document_idx").on(t.documentId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    assigneeId: uuid("assignee_id").references(() => users.id),
    dueDate: date("due_date", { mode: "string" }),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: priorityEnum("priority").notNull().default("normal"),
    requiresClientAction: boolean("requires_client_action").notNull().default(false),
    relatedMessageId: uuid("related_message_id"),
    relatedDocumentId: uuid("related_document_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** A task that must be done first; until then this one is waiting ("blocked"). */
    dependsOnId: uuid("depends_on_id"),
    /** The milestone (stage of the work plan) it belongs to. */
    milestoneId: uuid("milestone_id"),
    aiRunId: uuid("ai_run_id"),
    createdById: uuid("created_by_id").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_case_idx").on(t.caseId), index("tasks_assignee_idx").on(t.assigneeId)],
);

/** A stage of a case's work plan, with a target date; done when all its tasks are, or by hand. */
export const caseMilestones = pgTable(
  "case_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    clientVisible: boolean("client_visible").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("case_milestones_case_idx").on(t.caseId, t.sortOrder)],
);

/** "When X happens on a case, do Y": set by admins under Settings → Automation. */
export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  trigger: text("trigger").$type<AutomationTrigger>().notNull(),
  /** For status_changed: the status reached. */
  triggerStatus: text("trigger_status"),
  /** Only cases of this service type (null = all). */
  category: text("category"),
  action: jsonb("action").$type<AutomationAction>().notNull(),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Saved replies for the team (Hebrew and English), with {client} and {number} placeholders. */
export const replyTemplates = pgTable("reply_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  bodyHe: text("body_he").notNull().default(""),
  bodyEn: text("body_en").notNull().default(""),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: quoteStatusEnum("status").notNull().default("draft"),
    serviceName: text("service_name").notNull().default(""),
    scope: text("scope").notNull().default(""),
    included: text("included").notNull().default(""),
    excluded: text("excluded").notNull().default(""),
    currency: text("currency").notNull().default("ILS"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("18"),
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    paymentTerms: text("payment_terms").notNull().default(""),
    timeline: text("timeline").notNull().default(""),
    terms: text("terms").notNull().default(""),
    validUntil: date("valid_until", { mode: "string" }),
    aiRunId: uuid("ai_run_id"),
    sentSnapshot: jsonb("sent_snapshot").$type<Record<string, unknown> | null>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Follow-ups sent while the quote waits for an answer (client reminder, then a note to the handler). */
    clientFollowupAt: timestamp("client_followup_at", { withTimezone: true }),
    staffFollowupAt: timestamp("staff_followup_at", { withTimezone: true }),
    sentById: uuid("sent_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvalIp: text("approval_ip"),
    approvalSnapshotHash: text("approval_snapshot_hash"),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quotes_case_idx").on(t.caseId)],
);

export const quoteItems = pgTable("quote_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  priceListItemId: uuid("price_list_item_id"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id"),
    providerPaymentId: text("provider_payment_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdById: uuid("created_by_id").references(() => users.id),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_case_idx").on(t.caseId), index("payments_session_idx").on(t.providerSessionId)],
);

/** Idempotency ledger for payment provider webhooks. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    paymentId: uuid("payment_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_events_provider_event_idx").on(t.provider, t.providerEventId)],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    caseId: uuid("case_id"),
    intakeSessionId: uuid("intake_session_id"),
    userId: uuid("user_id"),
    status: aiRunStatusEnum("status").notNull().default("ok"),
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_runs_case_idx").on(t.caseId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id"),
    type: text("type").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    toEmail: text("to_email"),
    /** WhatsApp number (digits, international format) for the "whatsapp" channel. */
    toPhone: text("to_phone"),
    /** The provider's message id (WhatsApp), to match delivery updates and replies to the case. */
    externalId: text("external_id"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    readAt: timestamp("read_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_status_idx").on(t.status), index("notifications_external_idx").on(t.externalId)],
);

/** A browser/device that agreed to receive push notifications (Web Push). One user can have several. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_entity_idx").on(t.entityType, t.entityId)],
);

export const serviceTemplates = pgTable("service_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"),
  description: text("description").notNull().default(""),
  tasks: jsonb("tasks").$type<ServiceTemplateTask[]>().notNull().default([]),
  stages: jsonb("stages").$type<ServiceTemplateStage[]>().notNull().default([]),
  documents: jsonb("documents").$type<ServiceTemplateDocument[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("other"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    currency: text("currency").notNull().default("ILS"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("price_list_code_idx").on(t.code)],
);

/** A staff member's saved filters on the Work queue page (the query string of the view). */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    query: text("query").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saved_views_user_name_idx").on(t.userId, t.name)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

/** Encrypted file contents for STORAGE_PROVIDER=database (hosting without a persistent disk). */
export const fileBlobs = pgTable("file_blobs", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type CaseEvent = typeof caseEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentFile = typeof documentFiles.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Signature = typeof signatures.$inferSelect;
export type ServiceCategoryRow = typeof serviceCategories.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type CaseFeedback = typeof caseFeedback.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type IntakeSession = typeof intakeSessions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ServiceTemplate = typeof serviceTemplates.$inferSelect;
export type CaseMilestone = typeof caseMilestones.$inferSelect;
export type AutomationRule = typeof automationRules.$inferSelect;
export type ReplyTemplate = typeof replyTemplates.$inferSelect;
export type PriceListItem = typeof priceListItems.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type CaseStatus = (typeof caseStatusEnum.enumValues)[number];
export type Urgency = (typeof urgencyEnum.enumValues)[number];
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type QuoteStatus = (typeof quoteStatusEnum.enumValues)[number];
export type CustomerType = (typeof customerTypeEnum.enumValues)[number];
