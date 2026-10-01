-- During parent deletion the inspiration FK also removes all copied evidence
-- and embeddings. Updating those rows from a child's deletion trigger can
-- recheck their FK after the parent is already gone. Only independently
-- edited/deleted reflections need this redaction path.
CREATE OR REPLACE FUNCTION "public"."redact_reflection_copies"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inspirations WHERE id = OLD.inspiration_id AND profile_id = OLD.profile_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
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
  DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type::text = 'generate_reflection_question'
    AND payload->>'inspirationId' = OLD.inspiration_id::text;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."refuse_withdrawn_signal_evidence"() RETURNS trigger AS $$
DECLARE latest_verdict text;
BEGIN
  -- Support writers protect mutable signal fields with NO KEY UPDATE so
  -- artifact citation FKs can finish. SHARE still waits for those writers;
  -- KEY SHARE would let an old insert check before withdrawal commits.
  PERFORM 1 FROM signals s WHERE s.profile_id = NEW.profile_id AND s.id = NEW.signal_id FOR SHARE;
  SELECT r.verdict INTO latest_verdict FROM signal_support_reviews r
    WHERE r.profile_id = NEW.profile_id AND r.owner_profile_id = NEW.owner_profile_id
      AND r.signal_id = NEW.signal_id AND r.inspiration_id = NEW.inspiration_id
      AND r.verdict <> 'unresolved'
    ORDER BY r.created_at DESC, r.review_id DESC LIMIT 1;
  IF latest_verdict = 'unsupported' THEN
    RAISE EXCEPTION 'Explicitly withdrawn support requires a new supported review' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."redact_attachment_copies"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inspirations WHERE id = OLD.inspiration_id AND profile_id = OLD.profile_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
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
CREATE OR REPLACE FUNCTION "public"."redact_inspiration_copies"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Remove witnesses while their parent still exists. Otherwise the later
    -- reflection FK's SET NULL can update evidence after the parent vanished.
    DELETE FROM signal_evidence WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.id;
    DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type::text = 'generate_reflection_question'
      AND payload->>'inspirationId' = OLD.id::text;
    RETURN OLD;
  END IF;
  IF ROW(OLD.text, OLD.kind, OLD.source, OLD.visibility) IS NOT DISTINCT FROM ROW(NEW.text, NEW.kind, NEW.source, NEW.visibility) THEN RETURN NEW; END IF;
  UPDATE signal_evidence SET reason = NULL WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.id;
  IF OLD.text IS DISTINCT FROM NEW.text THEN
    UPDATE signal_evidence SET quote = NULL, quote_source = NULL, quote_source_hash = NULL
      WHERE owner_profile_id = OLD.profile_id AND inspiration_id = OLD.id AND quote_reflection_id IS NULL;
    DELETE FROM background_jobs WHERE profile_id = OLD.profile_id AND type::text = 'generate_reflection_question'
      AND payload->>'inspirationId' = OLD.id::text;
  END IF;
  DELETE FROM inspiration_embeddings WHERE profile_id = OLD.profile_id AND inspiration_id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
