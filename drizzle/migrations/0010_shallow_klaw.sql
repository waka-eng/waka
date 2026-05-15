CREATE TYPE "public"."inspiration_revisit_event_type" AS ENUM('detail_opened', 'detail_returned', 'reflection_created', 'inspiration_updated');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspiration_revisit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"event_type" "inspiration_revisit_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspiration_revisit_events" ADD CONSTRAINT "inspiration_revisit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspiration_revisit_events" ADD CONSTRAINT "inspiration_revisit_events_inspiration_id_inspirations_id_fk" FOREIGN KEY ("inspiration_id") REFERENCES "public"."inspirations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspiration_revisit_events_inspiration_created_idx" ON "inspiration_revisit_events" USING btree ("user_id","inspiration_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspiration_revisit_events_user_created_idx" ON "inspiration_revisit_events" USING btree ("user_id","created_at" DESC NULLS LAST);