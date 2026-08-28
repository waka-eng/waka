CREATE TYPE "public"."group_membership_event_kind" AS ENUM('joined', 'left', 'removed');--> statement-breakpoint
CREATE TABLE "group_membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "group_membership_event_kind" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" DROP CONSTRAINT "top_of_mind_entry_signals_signal_id_signals_id_fk";
--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ALTER COLUMN "signal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "group_membership_events" ADD CONSTRAINT "group_membership_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership_events" ADD CONSTRAINT "group_membership_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_membership_events_group_occurred_idx" ON "group_membership_events" USING btree ("group_id","occurred_at");--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD CONSTRAINT "top_of_mind_entry_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Existing seats carry the only join dates that survived the pre-ledger era:
-- seed each current member's arrival from their membership row, so the
-- timeline does not start mid-story for rooms that already exist. Departures
-- before this migration are unrecoverable and deliberately not invented.
INSERT INTO "group_membership_events" ("group_id", "profile_id", "kind", "occurred_at")
SELECT "group_id", "profile_id", 'joined', "created_at" FROM "group_members";
