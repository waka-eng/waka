-- Duplicates: proposed, never merged alone.
--
-- The gardener's findings need a place to stand. A row here is the machine
-- saying "these two statements name one pattern" — judged, on the record,
-- and WAITING: the merge itself is the owner's act, resolved through the
-- API with either `merged` (evidence unions under the survivor, citations
-- repoint, the other retires with its provenance intact) or `kept_apart`
-- (a standing answer the gardener respects forever — the pair is never
-- proposed again).
--
-- Undirected like signal_contradictions: stored once with a < b, so the
-- same pair cannot drift into two rows. `merged_into_signal_id` is the
-- survivor when resolved as merged — the provenance a person's history can
-- point to. Composite FKs to (profile_id, signal id) like the contradiction
-- table's, cascading with the signal: a deleted signal takes its proposals
-- with it, which is the cascade rule evidence already follows.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."duplicate_resolution" AS ENUM ('merged', 'kept_apart');--> statement-breakpoint
CREATE TABLE "signal_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"a_signal_id" uuid NOT NULL,
	"b_signal_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" "duplicate_resolution",
	"merged_into_signal_id" uuid
);--> statement-breakpoint
ALTER TABLE "signal_duplicates" ADD CONSTRAINT "signal_duplicates_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_duplicates" ADD CONSTRAINT "signal_duplicates_a_fk" FOREIGN KEY ("profile_id","a_signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_duplicates" ADD CONSTRAINT "signal_duplicates_b_fk" FOREIGN KEY ("profile_id","b_signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_duplicates_pair_unique_idx" ON "signal_duplicates" USING btree ("a_signal_id","b_signal_id");--> statement-breakpoint
CREATE INDEX "signal_duplicates_profile_idx" ON "signal_duplicates" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "signal_duplicates_a_idx" ON "signal_duplicates" USING btree ("a_signal_id");--> statement-breakpoint
CREATE INDEX "signal_duplicates_b_idx" ON "signal_duplicates" USING btree ("b_signal_id");
