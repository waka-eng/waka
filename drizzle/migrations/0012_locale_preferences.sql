ALTER TABLE "users" ADD COLUMN "preferred_locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "wow_moments" ADD COLUMN "locale" text DEFAULT 'en-US' NOT NULL;