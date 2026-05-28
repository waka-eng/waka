ALTER TYPE "public"."background_job_type" ADD VALUE IF NOT EXISTS 'meaning_graph_rebuild';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_active_meaning_graph_rebuild_user_idx"
  ON "background_jobs" USING btree ("user_id", "type")
  WHERE "type" = 'meaning_graph_rebuild'::"background_job_type"
    AND "status" IN ('pending'::"background_job_status", 'running'::"background_job_status");
