CREATE TABLE "signup_admissions" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"stage" text NOT NULL,
	"flow" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"creation_started_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"oauth_state_hash" text,
	"oauth_pkce_hash" text,
	CONSTRAINT "signup_admissions_shape" CHECK ("signup_admissions"."nonce_hash" ~ '^[0-9a-f]{64}$' AND "signup_admissions"."token_hash" ~ '^[0-9a-f]{64}$'
 AND "signup_admissions"."stage" IN ('development','dev','production') AND "signup_admissions"."flow" IN ('password','google')
 AND "signup_admissions"."state" IN ('reserved','verified','rejected','unknown','creating','oauth_bound','consumed')
 AND "signup_admissions"."expires_at" > "signup_admissions"."created_at"
 AND (("signup_admissions"."oauth_state_hash" IS NULL AND "signup_admissions"."oauth_pkce_hash" IS NULL) OR ("signup_admissions"."oauth_state_hash" IS NOT NULL AND "signup_admissions"."oauth_pkce_hash" IS NOT NULL AND "signup_admissions"."oauth_state_hash" ~ '^[0-9a-f]{64}$' AND "signup_admissions"."oauth_pkce_hash" ~ '^[0-9a-f]{64}$'))
 AND ("signup_admissions"."state" <> 'consumed' OR ("signup_admissions"."consumed_at" IS NOT NULL AND "signup_admissions"."creation_started_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signup_admissions_token_unique" ON "signup_admissions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "signup_admissions_created_idx" ON "signup_admissions" USING btree ("stage","created_at");--> statement-breakpoint
CREATE INDEX "signup_admissions_creation_idx" ON "signup_admissions" USING btree ("stage","creation_started_at");