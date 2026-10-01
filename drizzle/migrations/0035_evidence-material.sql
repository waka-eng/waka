ALTER TABLE "public"."signal_evidence" ADD COLUMN "quote_reflection_id" uuid;
--> statement-breakpoint
ALTER TABLE "public"."signal_evidence" ADD COLUMN "quote_source_hash" text;
--> statement-breakpoint
ALTER TABLE "public"."signal_evidence" ADD COLUMN "material" jsonb;
--> statement-breakpoint
ALTER TABLE "public"."reflections" ADD CONSTRAINT "reflections_source_identity_unique"
  UNIQUE ("profile_id", "inspiration_id", "id");
--> statement-breakpoint
ALTER TABLE "public"."signal_evidence" ADD CONSTRAINT "signal_evidence_quote_reflection_fk"
  FOREIGN KEY ("owner_profile_id", "inspiration_id", "quote_reflection_id")
  REFERENCES "public"."reflections" ("profile_id", "inspiration_id", "id")
  ON DELETE SET NULL ("quote_reflection_id");
--> statement-breakpoint
ALTER TABLE "public"."signal_evidence" ADD CONSTRAINT "signal_evidence_private_quote_check"
  CHECK (quote_reflection_id IS NULL OR (profile_id = owner_profile_id AND quote IS NOT NULL
    AND (quote_source = 'own') IS TRUE AND quote_source_hash IS NOT NULL));
--> statement-breakpoint
-- Remove retained source copies, not the signal/entry/principle itself.
CREATE OR REPLACE FUNCTION "public"."redact_reflection_copies"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.question, OLD.answer, OLD.skipped, OLD.profile_id, OLD.inspiration_id)
    IS NOT DISTINCT FROM ROW(NEW.question, NEW.answer, NEW.skipped, NEW.profile_id, NEW.inspiration_id) THEN
    RETURN NEW;
  END IF;
  UPDATE signal_evidence e SET reason = NULL
    WHERE e.owner_profile_id = OLD.profile_id AND e.inspiration_id = OLD.inspiration_id
      AND (e.profile_id = OLD.profile_id OR e.quote_reflection_id = OLD.id OR EXISTS (
        SELECT 1 FROM signals s WHERE s.id = e.signal_id AND s.input_policy IS DISTINCT FROM 'group-public-v1'));
  UPDATE signal_evidence e SET quote = NULL, quote_source = NULL,
      quote_reflection_id = NULL, quote_source_hash = NULL
    WHERE e.owner_profile_id = OLD.profile_id AND e.inspiration_id = OLD.inspiration_id
      AND (e.quote_reflection_id = OLD.id OR (e.material IS NULL AND (
        e.profile_id = OLD.profile_id OR EXISTS (SELECT 1 FROM signals s WHERE s.id = e.signal_id
          AND s.input_policy IS DISTINCT FROM 'group-public-v1'))));
  DELETE FROM inspiration_embeddings WHERE profile_id = OLD.profile_id
    AND inspiration_id = OLD.inspiration_id AND input_scope = 'personal';
  DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type = 'generate_reflection_question'
    AND payload->>'inspirationId' = OLD.inspiration_id::text;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reflections_redact_copies BEFORE UPDATE OR DELETE ON "public"."reflections"
  FOR EACH ROW EXECUTE FUNCTION "public"."redact_reflection_copies"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."redact_inspiration_copies"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type = 'generate_reflection_question'
      AND payload->>'inspirationId' = OLD.id::text;
    RETURN OLD;
  END IF;
  IF ROW(OLD.text, OLD.kind, OLD.source, OLD.visibility) IS NOT DISTINCT FROM ROW(NEW.text, NEW.kind, NEW.source, NEW.visibility) THEN RETURN NEW; END IF;
  UPDATE signal_evidence SET reason = NULL WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.id;
  IF OLD.text IS DISTINCT FROM NEW.text THEN
    UPDATE signal_evidence SET quote = NULL, quote_source = NULL, quote_source_hash = NULL
      WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.id AND quote_reflection_id IS NULL;
    DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type = 'generate_reflection_question'
      AND payload->>'inspirationId' = OLD.id::text;
  END IF;
  DELETE FROM inspiration_embeddings WHERE profile_id = OLD.profile_id AND inspiration_id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspirations_redact_copies BEFORE UPDATE OR DELETE ON "public"."inspirations"
  FOR EACH ROW EXECUTE FUNCTION "public"."redact_inspiration_copies"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."redact_attachment_copies"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.url, OLD.enrichment_text, OLD.enrichment_kind, OLD.enrichment_status, OLD.name, OLD.hostname)
    IS NOT DISTINCT FROM ROW(NEW.url, NEW.enrichment_text, NEW.enrichment_kind, NEW.enrichment_status, NEW.name, NEW.hostname) THEN RETURN NEW; END IF;
  UPDATE signal_evidence SET reason = NULL WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id;
  UPDATE signal_evidence SET quote = NULL, quote_source = NULL, quote_source_hash = NULL
    WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id AND quote_source = 'enrichment';
  DELETE FROM inspiration_embeddings WHERE profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attachments_redact_copies BEFORE UPDATE OR DELETE ON "public"."attachments"
  FOR EACH ROW EXECUTE FUNCTION "public"."redact_attachment_copies"();
