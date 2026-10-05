-- Nullable projection columns avoid rewriting historical source rows.
ALTER TABLE "public"."inspirations" ADD COLUMN "text_search_vector" tsvector;
--> statement-breakpoint
ALTER TABLE "public"."inspirations" ADD COLUMN "text_search_vector_policy" integer;
--> statement-breakpoint
CREATE FUNCTION "public"."sync_inspiration_text_search"() RETURNS trigger AS $$
BEGIN
  NEW.text_search_vector := to_tsvector('simple', NEW.text);
  NEW.text_search_vector_policy := 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspirations_text_search BEFORE INSERT OR UPDATE OF text ON "public"."inspirations"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_inspiration_text_search"();
--> statement-breakpoint
-- Search metadata is not new material. Preserve the existing generic fence
-- for all other columns while refusing a search-only update as a reason to
-- invalidate readings or review support.
DROP TRIGGER inspirations_generation_revision ON "public"."inspirations";
--> statement-breakpoint
CREATE TRIGGER inspirations_generation_revision AFTER UPDATE ON "public"."inspirations"
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - ARRAY['updated_at','enrichment_updated_at','enrichment_error_reason','text_search_vector','text_search_vector_policy'])
      IS DISTINCT FROM
    (to_jsonb(NEW) - ARRAY['updated_at','enrichment_updated_at','enrichment_error_reason','text_search_vector','text_search_vector_policy'])
  ) EXECUTE FUNCTION "public"."source_generation_revision"();
