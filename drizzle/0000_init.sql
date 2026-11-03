CREATE TYPE "public"."actor_kind" AS ENUM('customer', 'staff', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('ok', 'error', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('draft', 'submitted', 'under_review', 'awaiting_information', 'quote_preparation', 'quote_sent', 'awaiting_payment', 'active', 'awaiting_client', 'completed', 'closed', 'cancelled', 'declined');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('private', 'business', 'company', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('requested', 'uploaded', 'in_review', 'approved', 'needs_new_version');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('client', 'internal');--> statement-breakpoint
CREATE TYPE "public"."intake_status" AS ENUM('active', 'submitted', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('thread', 'internal_note');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'read');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'clarification_requested', 'approved', 'declined', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'infected', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'waiting', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin', 'case_manager', 'staff', 'finance');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"case_id" uuid,
	"intake_session_id" uuid,
	"user_id" uuid,
	"status" "ai_run_status" DEFAULT 'ok' NOT NULL,
	"output" jsonb,
	"error" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"actor_kind" "actor_kind" DEFAULT 'system' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'internal' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_reads" (
	"user_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_reads_user_id_case_id_pk" PRIMARY KEY("user_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"service_category" text DEFAULT 'other' NOT NULL,
	"status" "case_status" DEFAULT 'submitted' NOT NULL,
	"urgency" "urgency" DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"intake_session_id" uuid,
	"intake_summary" jsonb,
	"ai_summary" jsonb,
	"locale" text DEFAULT 'he' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"last_client_activity_at" timestamp with time zone,
	"last_staff_activity_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "customer_type" DEFAULT 'private' NOT NULL,
	"organization_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"intake_session_id" uuid,
	"message_id" uuid,
	"title" text NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'client' NOT NULL,
	"request_note" text,
	"review_note" text,
	"requested_by_id" uuid,
	"created_by_id" uuid,
	"current_version" integer DEFAULT 0 NOT NULL,
	"ai_analysis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_token_hash" text,
	"user_id" uuid,
	"locale" text DEFAULT 'he' NOT NULL,
	"status" "intake_status" DEFAULT 'active' NOT NULL,
	"mode" text DEFAULT 'chat' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"summary_version" integer DEFAULT 0 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"question_limit" integer DEFAULT 7 NOT NULL,
	"ready_for_review" boolean DEFAULT false NOT NULL,
	"ai_failed" boolean DEFAULT false NOT NULL,
	"case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" "message_kind" DEFAULT 'thread' NOT NULL,
	"body" text NOT NULL,
	"is_info_request" boolean DEFAULT false NOT NULL,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"type" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"to_email" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payment_id" uuid,
	"payload" jsonb NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"provider_payment_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_by_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"price_list_item_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"service_name" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"included" text DEFAULT '' NOT NULL,
	"excluded" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"timeline" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"valid_until" date,
	"ai_run_id" uuid,
	"sent_snapshot" jsonb,
	"sent_at" timestamp with time zone,
	"sent_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approval_ip" text,
	"approval_snapshot_hash" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"requires_client_action" boolean DEFAULT false NOT NULL,
	"related_message_id" uuid,
	"related_document_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"ai_run_id" uuid,
	"created_by_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"locale" text DEFAULT 'he' NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"ai_consent_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reads" ADD CONSTRAINT "case_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reads" ADD CONSTRAINT "case_reads_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_case_idx" ON "ai_runs" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "auth_codes_email_idx" ON "auth_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "case_events_case_idx" ON "case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_number_idx" ON "cases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "cases_customer_idx" ON "cases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cases_assignee_idx" ON "cases" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_user_idx" ON "customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_files_doc_idx" ON "document_files" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "messages_case_idx" ON "messages" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_idx" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payments_case_idx" ON "payments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "payments_session_idx" ON "payments" USING btree ("provider_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_code_idx" ON "price_list_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "quotes_case_idx" ON "quotes" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tasks_case_idx" ON "tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");