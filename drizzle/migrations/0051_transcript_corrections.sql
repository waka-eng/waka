ALTER TABLE "attachments" ADD COLUMN "transcript_correction" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "transcript_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "transcript_corrected_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."track_attachment_material"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.id, OLD.profile_id, OLD.inspiration_id, OLD.type, OLD.url, OLD.s3_key, OLD.content_type, OLD.name,
      OLD.enrichment_status, OLD.enrichment_kind, OLD.enrichment_text, OLD.hostname, OLD.created_at, OLD.transcript_correction)
    IS NOT DISTINCT FROM ROW(NEW.id, NEW.profile_id, NEW.inspiration_id, NEW.type, NEW.url, NEW.s3_key, NEW.content_type, NEW.name,
      NEW.enrichment_status, NEW.enrichment_kind, NEW.enrichment_text, NEW.hostname, NEW.created_at, NEW.transcript_correction) THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM advance_inspiration_material(OLD.profile_id, OLD.inspiration_id, true); END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.profile_id <> NEW.profile_id OR OLD.inspiration_id <> NEW.inspiration_id)) THEN
    PERFORM advance_inspiration_material(NEW.profile_id, NEW.inspiration_id, true);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."redact_attachment_copies"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inspirations WHERE id = OLD.inspiration_id AND profile_id = OLD.profile_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(OLD.url, OLD.enrichment_text, OLD.enrichment_kind, OLD.enrichment_status, OLD.name, OLD.hostname, OLD.transcript_correction)
    IS NOT DISTINCT FROM ROW(NEW.url, NEW.enrichment_text, NEW.enrichment_kind, NEW.enrichment_status, NEW.name, NEW.hostname, NEW.transcript_correction) THEN RETURN NEW; END IF;
  UPDATE signal_evidence SET reason = NULL WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id;
  UPDATE signal_evidence SET quote = NULL, quote_source = NULL, quote_source_hash = NULL
    WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id AND quote_source = 'enrichment';
  DELETE FROM inspiration_embeddings WHERE profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
