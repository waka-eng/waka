CREATE TABLE IF NOT EXISTS "group_top_of_mind_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "wow_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"why" text NOT NULL,
	"belief_statement" text,
	"reflection_question" text,
	"reflection_guide" text,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"wow_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_top_of_mind_note_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_top_of_mind_note_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"role" text DEFAULT 'related' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_top_of_mind_notes" ADD CONSTRAINT "group_top_of_mind_notes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_top_of_mind_note_signals" ADD CONSTRAINT "group_top_of_mind_note_signals_group_top_of_mind_note_id_fk" FOREIGN KEY ("group_top_of_mind_note_id") REFERENCES "public"."group_top_of_mind_notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_top_of_mind_note_signals" ADD CONSTRAINT "group_top_of_mind_note_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_top_of_mind_note_signals" ADD CONSTRAINT "group_top_of_mind_note_signals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "group_top_of_mind_note_signals" ADD CONSTRAINT "group_top_of_mind_note_signals_signal_owner_fk" FOREIGN KEY ("signal_id","owner_user_id") REFERENCES "public"."signals"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_top_of_mind_notes_group_idempotency_key_unique_idx" ON "group_top_of_mind_notes" USING btree ("group_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_top_of_mind_notes_group_created_idx" ON "group_top_of_mind_notes" USING btree ("group_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_top_of_mind_note_signals_note_order_idx" ON "group_top_of_mind_note_signals" USING btree ("group_top_of_mind_note_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_top_of_mind_note_signals_note_signal_unique_idx" ON "group_top_of_mind_note_signals" USING btree ("group_top_of_mind_note_id","signal_id");
