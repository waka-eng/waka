ALTER TABLE "top_of_mind_entry_signals" DROP CONSTRAINT "top_of_mind_entry_signals_owner_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "group_membership_events" DROP CONSTRAINT "group_membership_events_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "group_top_of_mind_affirmations" DROP CONSTRAINT "group_top_of_mind_affirmations_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "group_top_of_mind_proposals" DROP CONSTRAINT "group_top_of_mind_proposals_proposed_by_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "group_membership_events" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_affirmations" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_proposals" ALTER COLUMN "proposed_by_profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD CONSTRAINT "top_of_mind_entry_signals_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership_events" ADD CONSTRAINT "group_membership_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_affirmations" ADD CONSTRAINT "group_top_of_mind_affirmations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_proposals" ADD CONSTRAINT "group_top_of_mind_proposals_proposed_by_profile_id_profiles_id_fk" FOREIGN KEY ("proposed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;