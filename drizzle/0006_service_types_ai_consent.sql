CREATE TABLE "service_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"created_by_ai" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_consent_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Self-registered clients who left AI unticked already answered; only accounts the team opened (no terms acceptance yet) are asked.
UPDATE "users" SET "ai_consent_declined_at" = "created_at" WHERE "role" = 'customer' AND "ai_consent_at" IS NULL AND "terms_accepted_at" IS NOT NULL;
