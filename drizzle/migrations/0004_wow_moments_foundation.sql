ALTER TABLE "inspirations" ADD COLUMN "importance_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inspirations" ADD COLUMN "wow_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TYPE "public"."wow_kind" AS ENUM('recurrence', 'bridge', 'surprise_bridge', 'tension', 'outlier');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wow_moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "wow_kind" NOT NULL,
	"why" text NOT NULL,
	"reflection_question" text,
	"wow_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wow_moment_inspirations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wow_moment_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"role" text DEFAULT 'related' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wow_moments" ADD CONSTRAINT "wow_moments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wow_moment_inspirations" ADD CONSTRAINT "wow_moment_inspirations_wow_moment_id_wow_moments_id_fk" FOREIGN KEY ("wow_moment_id") REFERENCES "public"."wow_moments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wow_moment_inspirations" ADD CONSTRAINT "wow_moment_inspirations_inspiration_id_inspirations_id_fk" FOREIGN KEY ("inspiration_id") REFERENCES "public"."inspirations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wow_moments_user_created_idx" ON "wow_moments" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wow_moments_user_score_idx" ON "wow_moments" USING btree ("user_id","wow_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wow_moment_inspirations_moment_order_idx" ON "wow_moment_inspirations" USING btree ("wow_moment_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wow_moment_inspirations_inspiration_idx" ON "wow_moment_inspirations" USING btree ("inspiration_id");