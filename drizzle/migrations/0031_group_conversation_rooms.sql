CREATE TABLE IF NOT EXISTS "group_conversation_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"feedback_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_room_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid,
	"invited_email" text,
	"display_name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_room_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"share_raw" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_room_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"source_top_of_mind_note_id" uuid,
	"prompt_text" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"action_label" text DEFAULT 'Keep talking' NOT NULL,
	"evidence_previews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_room_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"prompt_id" uuid,
	"user_id" uuid NOT NULL,
	"reaction" text DEFAULT 'useful' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_conversation_rooms" ADD CONSTRAINT "group_conversation_rooms_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_participants" ADD CONSTRAINT "group_room_participants_room_id_group_conversation_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."group_conversation_rooms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_participants" ADD CONSTRAINT "group_room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_signals" ADD CONSTRAINT "group_room_signals_room_id_group_conversation_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."group_conversation_rooms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_signals" ADD CONSTRAINT "group_room_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_signals" ADD CONSTRAINT "group_room_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_prompts" ADD CONSTRAINT "group_room_prompts_room_id_group_conversation_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."group_conversation_rooms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_prompts" ADD CONSTRAINT "group_room_prompts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	-- `wow_moments` is the OLD name; the table is `top_of_mind_notes` and
	-- `wowMoments` survives only as an alias export in the Drizzle schema. This
	-- migration was hand-written rather than generated, so it inherited the
	-- alias and referenced a relation that does not exist.
	ALTER TABLE "group_room_prompts" ADD CONSTRAINT "group_room_prompts_source_top_of_mind_note_id_wow_moments_id_fk" FOREIGN KEY ("source_top_of_mind_note_id") REFERENCES "public"."top_of_mind_notes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_feedback" ADD CONSTRAINT "group_room_feedback_room_id_group_conversation_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."group_conversation_rooms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_feedback" ADD CONSTRAINT "group_room_feedback_prompt_id_group_room_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."group_room_prompts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_room_feedback" ADD CONSTRAINT "group_room_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_conversation_rooms_owner_created_idx" ON "group_conversation_rooms" USING btree ("owner_user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_room_participants_room_idx" ON "group_room_participants" USING btree ("room_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_room_participants_user_idx" ON "group_room_participants" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_room_participants_room_user_unique_idx" ON "group_room_participants" USING btree ("room_id","user_id") WHERE "group_room_participants"."user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_room_signals_room_created_idx" ON "group_room_signals" USING btree ("room_id","created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_room_signals_room_signal_unique_idx" ON "group_room_signals" USING btree ("room_id","signal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_room_prompts_room_created_idx" ON "group_room_prompts" USING btree ("room_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_room_feedback_room_created_idx" ON "group_room_feedback" USING btree ("room_id","created_at" DESC);
