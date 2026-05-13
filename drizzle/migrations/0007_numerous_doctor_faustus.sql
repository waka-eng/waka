DROP INDEX IF EXISTS "wow_moment_inspirations_moment_order_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "wow_moment_inspirations_inspiration_idx";--> statement-breakpoint
ALTER TABLE "wow_moment_inspirations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "wow_moment_inspirations" wmi
SET "user_id" = wm."user_id"
FROM "wow_moments" wm
WHERE wmi."wow_moment_id" = wm."id"
  AND wmi."user_id" IS NULL;--> statement-breakpoint
-- Clean up previously-invalid cross-tenant wow_moment_inspirations rows
-- before enforcing tenant-scoped composite FKs. Older schemas only required
-- each side to exist independently, so a WOW moment owned by one user could
-- be linked to an inspiration owned by another user. This data is not
-- production data, so deleting the invalid historical links is acceptable.
DELETE FROM "wow_moment_inspirations" wmi
USING "inspirations" i
WHERE wmi."inspiration_id" = i."id"
  AND i."user_id" IS DISTINCT FROM wmi."user_id";--> statement-breakpoint
-- Defensive cleanup for any legacy rows whose parent WOW moment could not be
-- resolved during the backfill. Such rows would fail SET NOT NULL below.
DELETE FROM "wow_moment_inspirations" wmi
WHERE wmi."user_id" IS NULL;--> statement-breakpoint
-- Defensive cleanup for any legacy rows whose inspiration no longer exists or
-- does not match the backfilled tenant. Such rows would fail the composite FK.
DELETE FROM "wow_moment_inspirations" wmi
WHERE NOT EXISTS (
  SELECT 1
  FROM "inspirations" i
  WHERE i."id" = wmi."inspiration_id"
    AND i."user_id" = wmi."user_id"
);--> statement-breakpoint
ALTER TABLE "wow_moment_inspirations" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wow_moments_user_id_id_unique_idx" ON "wow_moments" USING btree ("user_id","id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wow_moment_inspirations" ADD CONSTRAINT "wow_moment_inspirations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wow_moment_inspirations" ADD CONSTRAINT "wow_moment_inspirations_user_moment_fk" FOREIGN KEY ("user_id","wow_moment_id") REFERENCES "public"."wow_moments"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wow_moment_inspirations" ADD CONSTRAINT "wow_moment_inspirations_user_inspiration_fk" FOREIGN KEY ("user_id","inspiration_id") REFERENCES "public"."inspirations"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wow_moment_inspirations_moment_order_idx" ON "wow_moment_inspirations" USING btree ("user_id","wow_moment_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wow_moment_inspirations_inspiration_idx" ON "wow_moment_inspirations" USING btree ("user_id","inspiration_id");