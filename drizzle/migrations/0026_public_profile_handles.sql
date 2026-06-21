ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "public_handle" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "public_profile_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "public_top_of_mind_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_public_handle_unique_idx" ON "users" USING btree ("public_handle") WHERE "public_handle" IS NOT NULL;
