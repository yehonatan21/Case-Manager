ALTER TYPE "public"."notification_channel" ADD VALUE 'whatsapp';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "to_phone" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_last_inbound_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_idx" ON "messages" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "notifications_external_idx" ON "notifications" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "users_whatsapp_idx" ON "users" USING btree ("whatsapp_phone");