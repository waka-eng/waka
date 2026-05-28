CREATE TYPE "attachment_enrichment_status" AS ENUM ('pending', 'ready', 'failed', 'unavailable');--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "enrichment_status" "attachment_enrichment_status";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "enrichment_source" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "enrichment_source_url" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "enrichment_error_reason" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "enrichment_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "final_url" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "hostname" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "site_name" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "preview_image_url" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "image_height" integer;
