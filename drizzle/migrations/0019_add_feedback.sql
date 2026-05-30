CREATE TYPE "feedback_target" AS ENUM ('signal', 'context_node', 'top_of_mind_note', 'hypothesis');--> statement-breakpoint
CREATE TYPE "feedback_value" AS ENUM ('true', 'partly', 'not_true', 'important', 'not_important');--> statement-breakpoint
CREATE TYPE "feedback_emotion" AS ENUM ('admire', 'envy', 'want', 'fear', 'curious', 'aesthetic_only');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "feedback_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"value" "feedback_value" NOT NULL,
	"emotion_label" "feedback_emotion",
	"correction_text" text,
	"source" text DEFAULT 'user' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_user_target_idx" ON "feedback" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_user_created_idx" ON "feedback" USING btree ("user_id","created_at" DESC);
