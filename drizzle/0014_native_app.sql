CREATE TABLE "app_sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"challenge" text NOT NULL,
	"user_id" uuid,
	"mfa_pending" boolean DEFAULT false NOT NULL,
	"signup_token" text,
	"next" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_sign_ins" ADD CONSTRAINT "app_sign_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_sign_ins_code_idx" ON "app_sign_ins" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "native_push_tokens_token_idx" ON "native_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "native_push_tokens_user_idx" ON "native_push_tokens" USING btree ("user_id");