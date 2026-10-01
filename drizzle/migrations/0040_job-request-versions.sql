-- A reused job id is not a receipt for the next request. Existing outcomes
-- have no recorded request version; do not backfill them as verified work.
ALTER TABLE "public"."background_jobs" ADD COLUMN "request_version" bigint NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "public"."background_jobs" ADD COLUMN "completed_version" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "public"."background_jobs" ADD CONSTRAINT "background_jobs_request_version_check"
  CHECK (request_version > 0 AND completed_version >= 0 AND completed_version <= request_version);
