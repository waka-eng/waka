-- Membership becomes memory.
--
-- `group_members` says who is here now; leaving deletes the row, so a
-- departed member never existed and the room cannot say when it became four
-- people. This is the append-only record that makes a join a hinge on the
-- room's timeline.
--
-- Guarded like its neighbours so a partially-applied migration can be retried.
DO $$ BEGIN
  CREATE TYPE "group_member_event" AS ENUM('joined', 'left', 'removed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_member_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "event" "group_member_event" NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_member_events" ADD CONSTRAINT "group_member_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_member_events" ADD CONSTRAINT "group_member_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_member_events_group_at_idx" ON "group_member_events" ("group_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_member_events_group_user_idx" ON "group_member_events" ("group_id","user_id");
--> statement-breakpoint
-- Backfill: every current membership joined at its row's created_at. Idempotent
-- via NOT EXISTS, so re-running the migration cannot double-write a join.
INSERT INTO "group_member_events" ("group_id", "user_id", "event", "at")
SELECT m."group_id", m."user_id", 'joined', m."created_at"
FROM "group_members" m
WHERE NOT EXISTS (
  SELECT 1 FROM "group_member_events" e
  WHERE e."group_id" = m."group_id"
    AND e."user_id" = m."user_id"
    AND e."event" = 'joined'
);
