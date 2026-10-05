CREATE TABLE "principle_generation_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "billing_profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "job_id" uuid,
  "input_hash" text NOT NULL, "step_key" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('model','publication')),
  "status" text NOT NULL CHECK ("status" IN ('running','ready','failed')),
  "response" jsonb,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  CONSTRAINT "principle_generation_steps_job_fk" FOREIGN KEY ("billing_profile_id","job_id") REFERENCES "background_jobs"("profile_id","id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "principle_generation_steps_lookup" ON "principle_generation_steps" ("profile_id","input_hash","step_key","status");--> statement-breakpoint
CREATE INDEX "principle_generation_steps_budget" ON "principle_generation_steps" ("billing_profile_id","started_at");--> statement-breakpoint
CREATE INDEX "principle_generation_steps_job" ON "principle_generation_steps" ("job_id","kind");
