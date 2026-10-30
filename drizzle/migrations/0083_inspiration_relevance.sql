ALTER TABLE "public"."inspirations"
  ADD COLUMN memory_excluded_at timestamptz,
  ADD COLUMN review_after timestamptz,
  ADD COLUMN review_version integer NOT NULL DEFAULT 0,
  ADD COLUMN review_request_id uuid,
  ADD COLUMN review_choice text,
  ADD CONSTRAINT inspirations_review_version CHECK (review_version >= 0),
  ADD CONSTRAINT inspirations_review_choice CHECK (review_choice IN ('relevant', 'not_relevant', 'later'));
--> statement-breakpoint
CREATE INDEX inspirations_review_due_idx ON "public"."inspirations"
  (profile_id, review_after, created_at, id)
  WHERE memory_excluded_at IS NULL;

--> statement-breakpoint
-- A deferral/confirmation changes scheduling, not source material. Exclusion
-- still invalidates generation; the same source words remain editable.
DROP TRIGGER inspirations_generation_revision ON "public"."inspirations";
--> statement-breakpoint
CREATE TRIGGER inspirations_generation_revision AFTER UPDATE ON "public"."inspirations"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['updated_at','enrichment_updated_at','enrichment_error_reason','text_search_vector','text_search_vector_policy','review_after','review_version','review_request_id','review_choice'])
      IS DISTINCT FROM
    (to_jsonb(NEW) - ARRAY['updated_at','enrichment_updated_at','enrichment_error_reason','text_search_vector','text_search_vector_policy','review_after','review_version','review_request_id','review_choice'])
  ) EXECUTE FUNCTION "public"."source_generation_revision"();
