-- A room's direction is now a living, collectively-shaped version history.
--
-- Combination identity must be scoped to a room: two different rooms can have
-- the same people without sharing wording or history. Unscoped combinations
-- (future subset/handshake origins) retain their own member-set uniqueness.
DROP INDEX IF EXISTS "combinations_member_set_hash_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "combinations_room_member_set_unique_idx"
  ON "combinations" USING btree ("group_id", "member_set_hash")
  WHERE "group_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "combinations_unscoped_member_set_unique_idx"
  ON "combinations" USING btree ("member_set_hash")
  WHERE "group_id" IS NULL;--> statement-breakpoint

-- Generation provenance now separates saved material from member wording
-- responses, and carries the exact signal set for an honest "new since" count.
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "material_set_hash" text;--> statement-breakpoint
UPDATE "combination_readings"
SET "material_set_hash" = "signal_set_hash"
WHERE "material_set_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "combination_readings" ALTER COLUMN "material_set_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "evidence_signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "previous_reading_id" uuid;--> statement-breakpoint
ALTER TABLE "combination_readings" ADD COLUMN IF NOT EXISTS "change_summary" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "combination_readings"
    ADD CONSTRAINT "combination_readings_previous_reading_id_fk"
    FOREIGN KEY ("previous_reading_id") REFERENCES "public"."combination_readings"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Small attributed notes around the current wording. These are not votes: they
-- are the human language the next proposed reading is asked to absorb.
CREATE TABLE IF NOT EXISTS "group_direction_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "reading_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_direction_contributions"
    ADD CONSTRAINT "group_direction_contributions_group_id_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_direction_contributions"
    ADD CONSTRAINT "group_direction_contributions_reading_id_combination_readings_id_fk"
    FOREIGN KEY ("reading_id") REFERENCES "public"."combination_readings"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_direction_contributions"
    ADD CONSTRAINT "group_direction_contributions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_direction_contributions_group_created_idx"
  ON "group_direction_contributions" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_direction_contributions_reading_created_idx"
  ON "group_direction_contributions" USING btree ("reading_id", "created_at");--> statement-breakpoint

-- One mutable review response per member. The proposed reading remains
-- immutable; members can change their response until the room settles it.
CREATE TABLE IF NOT EXISTS "group_direction_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "reading_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_direction_responses"
    ADD CONSTRAINT "group_direction_responses_group_id_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_direction_responses"
    ADD CONSTRAINT "group_direction_responses_reading_id_combination_readings_id_fk"
    FOREIGN KEY ("reading_id") REFERENCES "public"."combination_readings"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_direction_responses"
    ADD CONSTRAINT "group_direction_responses_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_direction_responses_member_unique_idx"
  ON "group_direction_responses" USING btree ("reading_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_direction_responses_group_reading_idx"
  ON "group_direction_responses" USING btree ("group_id", "reading_id");
