ALTER TYPE "public"."background_job_type" ADD VALUE IF NOT EXISTS 'group_reading_refresh';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_group_reading_lookup_idx"
  ON "public"."background_jobs" USING btree ("type", (("payload" ->> 'groupId')), "created_at" DESC);
