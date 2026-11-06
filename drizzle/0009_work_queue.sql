CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "due_reminded_on" date;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "waiting_on_third_party" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "waiting_note" text;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_name_idx" ON "saved_views" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "cases_due_idx" ON "cases" USING btree ("due_date");