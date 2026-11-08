CREATE TABLE "case_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"minutes" integer,
	"started_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "org_role" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "org_access" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "details_confirmed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "details_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hourly_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "case_expenses" ADD CONSTRAINT "case_expenses_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_expenses" ADD CONSTRAINT "case_expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_expenses_case_idx" ON "case_expenses" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "time_entries_case_idx" ON "time_entries" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("user_id","date");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_details_confirmed_by_id_users_id_fk" FOREIGN KEY ("details_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing company accounts have a single member, their owner: they see all the company's cases.
UPDATE "customers" SET "org_access" = 'all' WHERE "organization_id" IS NOT NULL;
