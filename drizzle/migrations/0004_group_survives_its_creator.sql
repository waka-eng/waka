ALTER TABLE "groups" DROP CONSTRAINT "groups_created_by_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "created_by_profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_profile_id_profiles_id_fk" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;