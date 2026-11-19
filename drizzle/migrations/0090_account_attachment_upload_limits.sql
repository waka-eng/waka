CREATE TABLE "account_attachment_upload_limits" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"hour_started_at" timestamp with time zone NOT NULL,
	"issued_count" integer NOT NULL,
	"issued_bytes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_attachment_upload_limits" ADD CONSTRAINT "account_attachment_upload_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;