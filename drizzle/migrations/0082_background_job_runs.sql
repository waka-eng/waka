CREATE TABLE "background_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"request_version" bigint DEFAULT 1 NOT NULL,
	"attempt" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "background_job_runs" ADD CONSTRAINT "background_job_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_job_runs_account_window" ON "background_job_runs" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "background_job_runs_claim" ON "background_job_runs" USING btree ("job_id","started_at");--> statement-breakpoint
CREATE INDEX "background_job_runs_expiry" ON "background_job_runs" USING btree ("started_at");