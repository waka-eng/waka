-- New writers certify their entire input path, not only current citations.
-- Null legacy rows stay stored for reviewed repair; do not blanket backfill.
ALTER TABLE "public"."top_of_mind_entries" ADD COLUMN "input_policy" text;
--> statement-breakpoint
ALTER TABLE "public"."principles" ADD COLUMN "input_policy" text;
