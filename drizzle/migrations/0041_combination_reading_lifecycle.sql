-- A combination's readings stop being present-tense only.
--
-- `combination_readings` was written with one live row per (combination,
-- locale) — the same design 0038 had just corrected one layer down for group
-- notes. What a combination wanted in March is worth as much as what it wants
-- now: an ambition that keeps being re-derived is stronger evidence than one
-- seen once, and an ambition that changed is the most interesting thing a
-- room can show. Neither is visible if each reading overwrites the last.
--
-- Mirrors 0038's vocabulary deliberately (`lifecycle_status` / `replaced_at` /
-- `replaced_by_*`) so notes and readings age the same way and a timeline can
-- read both with one mental model.
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "lifecycle_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "replaced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "replaced_by_reading_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "combination_readings" ADD CONSTRAINT "combination_readings_replaced_by_reading_id_fk" FOREIGN KEY ("replaced_by_reading_id") REFERENCES "public"."combination_readings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- The old uniqueness said "one reading per combination per language, forever".
-- Succession needs "one ACTIVE reading per combination per language", with the
-- superseded ones kept beside it.
DROP INDEX IF EXISTS "combination_readings_combination_locale_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "combination_readings_active_unique_idx" ON "combination_readings" USING btree ("combination_id","locale") WHERE "lifecycle_status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "combination_readings_timeline_idx" ON "combination_readings" USING btree ("combination_id","created_at","replaced_at");
