-- A generated follow-up can now contain attachment material. Withdraw that
-- copy when its source changes, including corrected audio or removed photos.
CREATE FUNCTION "public"."redact_attachment_questions"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.id, OLD.profile_id, OLD.inspiration_id, OLD.type, OLD.enrichment_status,
    OLD.enrichment_kind, OLD.enrichment_text, OLD.transcript_correction)
    IS NOT DISTINCT FROM ROW(NEW.id, NEW.profile_id, NEW.inspiration_id, NEW.type, NEW.enrichment_status,
    NEW.enrichment_kind, NEW.enrichment_text, NEW.transcript_correction) THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type::text = 'generate_reflection_question'
      AND payload->>'inspirationId' = OLD.inspiration_id::text;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.profile_id <> NEW.profile_id OR OLD.inspiration_id <> NEW.inspiration_id)) THEN
    DELETE FROM background_jobs WHERE profile_id = NEW.profile_id AND type::text = 'generate_reflection_question'
      AND payload->>'inspirationId' = NEW.inspiration_id::text;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attachments_redact_questions BEFORE INSERT OR UPDATE OR DELETE ON "public"."attachments"
FOR EACH ROW EXECUTE FUNCTION "public"."redact_attachment_questions"();
