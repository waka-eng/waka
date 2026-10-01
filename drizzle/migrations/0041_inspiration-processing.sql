CREATE TABLE "public"."inspiration_revisions" (
  inspiration_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL,
  personal_revision bigint NOT NULL DEFAULT 1,
  public_revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_revisions_source_fk FOREIGN KEY (profile_id, inspiration_id)
    REFERENCES "public"."inspirations" (profile_id, id) ON DELETE CASCADE,
  CONSTRAINT inspiration_revisions_positive CHECK (personal_revision > 0 AND public_revision > 0)
);
--> statement-breakpoint
CREATE TABLE "public"."inspiration_processing" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES "public"."profiles" (id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL,
  inspiration_id uuid NOT NULL,
  material_revision bigint NOT NULL,
  derivation_job_id uuid REFERENCES "public"."background_jobs" (id) ON DELETE SET NULL,
  derivation_request_version bigint,
  reading_job_id uuid REFERENCES "public"."background_jobs" (id) ON DELETE SET NULL,
  reading_request_version bigint,
  result jsonb,
  derived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inspiration_processing_source_fk FOREIGN KEY (owner_profile_id, inspiration_id)
    REFERENCES "public"."inspirations" (profile_id, id) ON DELETE CASCADE,
  CONSTRAINT inspiration_processing_completion CHECK (material_revision > 0
    AND (completed_at IS NULL OR (derived_at IS NOT NULL AND result IS NOT NULL))),
  CONSTRAINT inspiration_processing_request_versions CHECK
    ((derivation_job_id IS NULL OR (derivation_request_version IS NOT NULL AND derivation_request_version > 0))
    AND (reading_job_id IS NULL OR (reading_request_version IS NOT NULL AND reading_request_version > 0)))
);
--> statement-breakpoint
CREATE INDEX inspiration_processing_source_idx ON "public"."inspiration_processing" (profile_id, inspiration_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX inspiration_processing_derivation_unique ON "public"."inspiration_processing" (profile_id, inspiration_id, derivation_job_id, derivation_request_version);
--> statement-breakpoint
CREATE INDEX inspiration_processing_reading_job_idx ON "public"."inspiration_processing" (reading_job_id, reading_request_version);
--> statement-breakpoint
CREATE FUNCTION "public"."advance_inspiration_material"(owner_id uuid, source_id uuid, include_public boolean) RETURNS void AS $$
BEGIN
  UPDATE inspiration_revisions SET personal_revision = personal_revision + 1,
    public_revision = public_revision + CASE WHEN include_public THEN 1 ELSE 0 END,
    updated_at = clock_timestamp()
    WHERE profile_id = owner_id AND inspiration_id = source_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "public"."track_inspiration_material"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inspiration_revisions(profile_id, inspiration_id) VALUES (NEW.profile_id, NEW.id);
  ELSIF ROW(OLD.text, OLD.kind, OLD.source, OLD.visibility, OLD.created_at)
    IS DISTINCT FROM ROW(NEW.text, NEW.kind, NEW.source, NEW.visibility, NEW.created_at) THEN
    PERFORM advance_inspiration_material(NEW.profile_id, NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspirations_material_revision AFTER INSERT OR UPDATE ON "public"."inspirations"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_inspiration_material"();
--> statement-breakpoint
CREATE FUNCTION "public"."track_reflection_material"() RETURNS trigger AS $$
DECLARE old_used boolean := false; new_used boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_used := NOT OLD.skipped AND OLD.answer IS NOT NULL; END IF;
  IF TG_OP <> 'DELETE' THEN new_used := NOT NEW.skipped AND NEW.answer IS NOT NULL; END IF;
  IF TG_OP = 'UPDATE' AND ROW(OLD.id, OLD.profile_id, OLD.inspiration_id, OLD.question, OLD.answer, OLD.skipped, OLD.created_at)
    IS NOT DISTINCT FROM ROW(NEW.id, NEW.profile_id, NEW.inspiration_id, NEW.question, NEW.answer, NEW.skipped, NEW.created_at) THEN RETURN NEW; END IF;
  IF old_used THEN PERFORM advance_inspiration_material(OLD.profile_id, OLD.inspiration_id, false); END IF;
  IF new_used AND (NOT old_used OR TG_OP = 'INSERT' OR OLD.profile_id <> NEW.profile_id OR OLD.inspiration_id <> NEW.inspiration_id) THEN
    PERFORM advance_inspiration_material(NEW.profile_id, NEW.inspiration_id, false);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reflections_material_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."reflections"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_reflection_material"();
--> statement-breakpoint
CREATE FUNCTION "public"."track_attachment_material"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.id, OLD.profile_id, OLD.inspiration_id, OLD.type, OLD.url, OLD.s3_key, OLD.content_type, OLD.name,
      OLD.enrichment_status, OLD.enrichment_kind, OLD.enrichment_text, OLD.hostname, OLD.created_at)
    IS NOT DISTINCT FROM ROW(NEW.id, NEW.profile_id, NEW.inspiration_id, NEW.type, NEW.url, NEW.s3_key, NEW.content_type, NEW.name,
      NEW.enrichment_status, NEW.enrichment_kind, NEW.enrichment_text, NEW.hostname, NEW.created_at) THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM advance_inspiration_material(OLD.profile_id, OLD.inspiration_id, true); END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.profile_id <> NEW.profile_id OR OLD.inspiration_id <> NEW.inspiration_id)) THEN
    PERFORM advance_inspiration_material(NEW.profile_id, NEW.inspiration_id, true);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attachments_material_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."attachments"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_attachment_material"();
--> statement-breakpoint
-- Install tracking before the baseline. Never overwrite a counter already
-- initialized by a capture during rollout. These are starting counters, not
-- invented knowledge of what legacy workers processed.
INSERT INTO "public"."inspiration_revisions" (profile_id, inspiration_id)
  SELECT profile_id, id FROM "public"."inspirations" ON CONFLICT (inspiration_id) DO NOTHING;
