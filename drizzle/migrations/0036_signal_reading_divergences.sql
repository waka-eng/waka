-- One row per (signal, group): how differently the same saved signal reads in
-- that room's Top of Mind versus its owner's own. Written by the scoring pass
-- after group synthesis and updated in place — a measurement, not a log.
--
-- The row references the owner's PRIVATE solo reading, so it may only ever be
-- surfaced to owner_user_id. Guarded like its neighbours so a partially
-- applied migration can be retried.
CREATE TABLE IF NOT EXISTS "signal_reading_divergences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "signal_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "solo_note_id" uuid NOT NULL,
  "group_note_id" uuid NOT NULL,
  "score" integer NOT NULL,
  "rationale" text DEFAULT '' NOT NULL,
  "locale" text DEFAULT 'en-US' NOT NULL,
  "judged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signal_reading_divergences" ADD CONSTRAINT "signal_reading_divergences_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signal_reading_divergences" ADD CONSTRAINT "signal_reading_divergences_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signal_reading_divergences" ADD CONSTRAINT "signal_reading_divergences_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signal_reading_divergences" ADD CONSTRAINT "signal_reading_divergences_solo_note_id_top_of_mind_notes_id_fk" FOREIGN KEY ("solo_note_id") REFERENCES "public"."top_of_mind_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signal_reading_divergences" ADD CONSTRAINT "signal_reading_divergences_group_note_id_group_top_of_mind_notes_id_fk" FOREIGN KEY ("group_note_id") REFERENCES "public"."group_top_of_mind_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signal_reading_divergences_signal_group_unique_idx" ON "signal_reading_divergences" ("signal_id","group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_reading_divergences_group_idx" ON "signal_reading_divergences" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_reading_divergences_owner_score_idx" ON "signal_reading_divergences" ("owner_user_id","score");
