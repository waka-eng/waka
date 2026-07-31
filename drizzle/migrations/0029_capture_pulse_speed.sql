-- `ALTER TYPE ... ADD VALUE` is safe inside the transaction drizzle-kit wraps
-- this in (PG12+, and Neon is 16) ONLY because nothing here uses the new value.
-- Postgres will not let a value be referenced in the same transaction that adds
-- it, so do not add a statement below that inserts or casts to 'capture_saved'.
ALTER TYPE "public"."signal_revisit_event_type" ADD VALUE 'capture_saved';--> statement-breakpoint
ALTER TABLE "signal_revisit_events" ADD COLUMN "elapsed_ms" integer;
