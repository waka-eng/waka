-- Group readings stop being destroyed.
--
-- Refresh pruned superseded notes with DELETE and a departing member's
-- readings were deleted outright, so a room had only a present tense: what it
-- read in March was gone, and the history the timeline replays cannot be
-- backfilled. Mirror the lifecycle the solo table already has, so a reading
-- that stops being current is marked rather than removed.
--
-- Guarded like its neighbours so a partially-applied migration can be retried.
ALTER TABLE "group_top_of_mind_notes" ADD COLUMN IF NOT EXISTS "lifecycle_status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "group_top_of_mind_notes" ADD COLUMN IF NOT EXISTS "replaced_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "group_top_of_mind_notes" ADD COLUMN IF NOT EXISTS "replaced_by_note_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_top_of_mind_notes" ADD CONSTRAINT "group_top_of_mind_notes_replaced_by_note_id_fk" FOREIGN KEY ("replaced_by_note_id") REFERENCES "public"."group_top_of_mind_notes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The wall reads actives; the timeline reads the whole succession by date.
CREATE INDEX IF NOT EXISTS "group_top_of_mind_notes_group_lifecycle_idx" ON "group_top_of_mind_notes" ("group_id","lifecycle_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_top_of_mind_notes_group_timeline_idx" ON "group_top_of_mind_notes" ("group_id","created_at","replaced_at");
