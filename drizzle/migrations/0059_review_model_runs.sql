CREATE TABLE "review_model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"job_id" uuid,
	"lease_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_model_runs" ADD CONSTRAINT "review_model_runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_model_runs_claim_unique" ON "review_model_runs" USING btree ("job_id","lease_at");--> statement-breakpoint
CREATE INDEX "review_model_runs_window_idx" ON "review_model_runs" USING btree ("profile_id","started_at");--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_owner_identity" UNIQUE("profile_id","id");
--> statement-breakpoint
ALTER TABLE review_answer_processing DROP CONSTRAINT review_answer_processing_derivation_job_id_background_jobs_id_fk;
--> statement-breakpoint
ALTER TABLE review_answer_processing DROP CONSTRAINT review_answer_processing_reading_job_id_background_jobs_id_fk;
--> statement-breakpoint
ALTER TABLE review_answer_processing ADD CONSTRAINT review_processing_derivation_job_fk FOREIGN KEY(profile_id,derivation_job_id)
REFERENCES background_jobs(profile_id,id) ON DELETE SET NULL(derivation_job_id);
--> statement-breakpoint
ALTER TABLE review_answer_processing ADD CONSTRAINT review_processing_reading_job_fk FOREIGN KEY(profile_id,reading_job_id)
REFERENCES background_jobs(profile_id,id) ON DELETE SET NULL(reading_job_id);
--> statement-breakpoint
ALTER TABLE review_model_runs ADD CONSTRAINT review_model_runs_job_fk FOREIGN KEY(profile_id,job_id)
REFERENCES background_jobs(profile_id,id) ON DELETE SET NULL(job_id);
--> statement-breakpoint
-- A rollout baseline, not invented historical attempts. New executions are
-- metered before their first model request; deleting work cannot erase spend.
INSERT INTO review_model_runs(profile_id,job_id,lease_at,started_at)
SELECT profile_id,id,coalesce(locked_at,started_at),started_at FROM background_jobs
WHERE type::text='derive_review_answer' AND started_at IS NOT NULL
ON CONFLICT(job_id,lease_at) DO NOTHING;
