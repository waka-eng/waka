ALTER TYPE "public"."signal_revisit_event_type" ADD VALUE 'capture_saved';--> statement-breakpoint
ALTER TABLE "signal_revisit_events" ADD COLUMN "elapsed_ms" integer;
