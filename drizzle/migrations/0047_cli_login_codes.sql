CREATE TABLE "cli_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cli_login_codes" ADD CONSTRAINT "cli_login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cli_login_codes_code_hash_unique_idx" ON "cli_login_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "cli_login_codes_expires_at_idx" ON "cli_login_codes" USING btree ("expires_at");
