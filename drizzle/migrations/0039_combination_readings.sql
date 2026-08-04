-- A combination is a set of hearts read together. A room is one origin of it.
--
-- Introduced now, before rooms are the only caller, so `combination-as-an-act`
-- can add `subset` and `handshake` origins without migrating twice.
--
-- `member_set_hash` is the canonical identity: sorted user ids, hashed. Reading
-- the same set twice is the same combination, so a reading can be cached,
-- re-confirmed, and invalidated when the set's shared signals change.
CREATE TABLE IF NOT EXISTS "combinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_set_hash" text NOT NULL,
	"origin" text DEFAULT 'room' NOT NULL,
	"group_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- What a combination wants, in its own words.
--
-- One dissolved statement, not a stack of summaries. The facet columns are
-- NULLABLE on purpose: a reading forced to fill impact AND people AND place
-- every time pads whichever the evidence does not actually speak to, which is
-- the stacking failure the personal board already corrected. An unfilled facet
-- belongs in `whats_missing`, not in prose nobody meant.
CREATE TABLE IF NOT EXISTS "combination_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"combination_id" uuid NOT NULL,
	"state" text DEFAULT 'forming' NOT NULL,
	"ambition_text" text,
	"impact" text,
	"people" text,
	"place" text,
	"away_from" text,
	"tension" text,
	"next_question" text,
	"whats_missing" text,
	"member_grades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grounded_note_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reconfirmed_count" integer DEFAULT 0 NOT NULL,
	"pulse_profile" jsonb,
	"evidence_span_start" timestamp with time zone,
	"evidence_span_end" timestamp with time zone,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"signal_set_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "combinations" ADD CONSTRAINT "combinations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "combinations" ADD CONSTRAINT "combinations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "combination_readings" ADD CONSTRAINT "combination_readings_combination_id_fk" FOREIGN KEY ("combination_id") REFERENCES "public"."combinations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "combinations_member_set_hash_unique_idx" ON "combinations" USING btree ("member_set_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "combinations_group_idx" ON "combinations" USING btree ("group_id");--> statement-breakpoint
-- One live reading per combination per language; history is not kept here.
CREATE UNIQUE INDEX IF NOT EXISTS "combination_readings_combination_locale_unique_idx" ON "combination_readings" USING btree ("combination_id","locale");
