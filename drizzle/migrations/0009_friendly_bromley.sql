CREATE TYPE "public"."background_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."background_job_type" AS ENUM('process_inspiration');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "background_job_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "background_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_runnable_idx" ON "background_jobs" USING btree ("run_after","created_at") WHERE "background_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_user_status_idx" ON "background_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_idempotency_key_unique_idx" ON "background_jobs" USING btree ("idempotency_key") WHERE "background_jobs"."idempotency_key" IS NOT NULL;