CREATE TABLE "mobile_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"app_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_login_codes" ADD CONSTRAINT "mobile_login_codes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_login_codes_code_hash_unique_idx" ON "mobile_login_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "mobile_login_codes_expires_at_idx" ON "mobile_login_codes" USING btree ("expires_at");