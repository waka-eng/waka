ALTER TYPE "public"."background_job_type" ADD VALUE 'generate_conversation_reply' BEFORE 'derive_review_answer';--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_owner_identity" UNIQUE("profile_id","conversation_id","id");--> statement-breakpoint
CREATE TABLE "conversation_reply_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_message_id" uuid,
	"assistant_message_id" uuid,
	"job_id" uuid,
	"conversation_revision" integer NOT NULL,
	"context_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"follow_up_question" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "conversation_replies_status_check" CHECK ("conversation_reply_requests"."status" IN ('pending','running','ready','failed','stopped','stale'))
);
--> statement-breakpoint
ALTER TABLE "conversation_reply_requests" ADD CONSTRAINT "conversation_reply_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reply_requests" ADD CONSTRAINT "conversation_replies_conversation_fk" FOREIGN KEY ("profile_id","conversation_id") REFERENCES "public"."conversations"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reply_requests" ADD CONSTRAINT "conversation_replies_user_message_fk" FOREIGN KEY ("profile_id","conversation_id","user_message_id") REFERENCES "public"."conversation_messages"("profile_id","conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reply_requests" ADD CONSTRAINT "conversation_replies_assistant_message_fk" FOREIGN KEY ("profile_id","conversation_id","assistant_message_id") REFERENCES "public"."conversation_messages"("profile_id","conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Keep dispatch accounting when completed queue rows are cleaned up.
ALTER TABLE "conversation_reply_requests" ADD CONSTRAINT "conversation_replies_job_fk" FOREIGN KEY ("profile_id","job_id") REFERENCES "public"."background_jobs"("profile_id","id") ON DELETE SET NULL("job_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_replies_one_active" ON "conversation_reply_requests" USING btree ("profile_id","conversation_id") WHERE "conversation_reply_requests"."status" IN ('pending','running');--> statement-breakpoint
CREATE INDEX "conversation_replies_message_idx" ON "conversation_reply_requests" USING btree ("profile_id","user_message_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_replies_budget_idx" ON "conversation_reply_requests" USING btree ("profile_id","dispatched_at");--> statement-breakpoint
