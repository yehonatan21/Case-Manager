CREATE TYPE "public"."signature_status" AS ENUM('requested', 'signed', 'cancelled');--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"document_id" uuid,
	"quote_id" uuid,
	"status" "signature_status" DEFAULT 'requested' NOT NULL,
	"note" text,
	"requested_by_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_version" integer,
	"signer_id" uuid,
	"signer_name" text,
	"signer_email" text,
	"method" text,
	"signed_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"original_sha256" text,
	"signed_sha256" text,
	"signed_file_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signatures_case_idx" ON "signatures" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "signatures_document_idx" ON "signatures" USING btree ("document_id");