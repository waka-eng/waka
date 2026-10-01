CREATE TABLE "public"."generation_revisions" (
  "profile_id" uuid PRIMARY KEY REFERENCES "public"."profiles" ("id") ON DELETE CASCADE,
  "revision" bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO "public"."generation_revisions" (profile_id) SELECT id FROM "public"."profiles";
--> statement-breakpoint
CREATE FUNCTION "public"."advance_generation_revisions"(ids uuid[]) RETURNS void AS $$
DECLARE target uuid;
BEGIN
  -- Stable order for multi-owner source changes; deleted profiles are ignored.
  FOR target IN SELECT id FROM profiles WHERE id = ANY(ids) ORDER BY id LOOP
    INSERT INTO generation_revisions(profile_id, revision) VALUES (target, 1)
      ON CONFLICT (profile_id) DO UPDATE SET revision = generation_revisions.revision + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "public"."source_generation_revision"() RETURNS trigger AS $$
DECLARE prior jsonb; current_row jsonb; source_ids uuid[]; owner_ids uuid[]; affected uuid[];
BEGIN
  prior := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  current_row := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' AND
    (prior - ARRAY['updated_at','enrichment_updated_at','enrichment_error_reason']) IS NOT DISTINCT FROM
    (current_row - ARRAY['updated_at','enrichment_updated_at','enrichment_error_reason']) THEN RETURN NEW; END IF;
  source_ids := CASE WHEN TG_TABLE_NAME = 'inspirations'
    THEN ARRAY[(prior->>'id')::uuid, (current_row->>'id')::uuid]
    ELSE ARRAY[(prior->>'inspiration_id')::uuid, (current_row->>'inspiration_id')::uuid] END;
  owner_ids := ARRAY[(prior->>'profile_id')::uuid, (current_row->>'profile_id')::uuid];
  SELECT array_agg(DISTINCT e.profile_id) INTO affected
    FROM signal_evidence e JOIN profiles p ON p.id = e.profile_id JOIN signals s ON s.id = e.signal_id
    WHERE e.inspiration_id = ANY(source_ids) AND e.owner_profile_id = ANY(owner_ids) AND (
      (p.type <> 'group' AND e.profile_id = e.owner_profile_id) OR
      (p.type = 'group' AND s.input_policy = 'group-public-v1' AND TG_TABLE_NAME <> 'reflections' AND (
        (TG_TABLE_NAME = 'inspirations' AND (prior->>'visibility' = 'public' OR current_row->>'visibility' = 'public')) OR
        (TG_TABLE_NAME = 'attachments' AND EXISTS (SELECT 1 FROM inspirations i WHERE i.id = e.inspiration_id AND i.visibility = 'public'))
      )));
  PERFORM advance_generation_revisions(affected);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspirations_generation_revision AFTER UPDATE ON "public"."inspirations"
  FOR EACH ROW EXECUTE FUNCTION "public"."source_generation_revision"();
--> statement-breakpoint
-- Lock all affected generation owners in a stable order before cascades
-- start removing the evidence that identifies them. DELETE has no ignored
-- conflict case, unlike INSERT ... ON CONFLICT DO NOTHING.
CREATE TRIGGER inspirations_generation_revision_delete BEFORE DELETE ON "public"."inspirations"
  FOR EACH ROW EXECUTE FUNCTION "public"."source_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER reflections_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."reflections"
  FOR EACH ROW EXECUTE FUNCTION "public"."source_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER attachments_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."attachments"
  FOR EACH ROW EXECUTE FUNCTION "public"."source_generation_revision"();
--> statement-breakpoint
CREATE FUNCTION "public"."owned_generation_revision"() RETURNS trigger AS $$
DECLARE prior jsonb; current_row jsonb; row_data jsonb; affected uuid[] := ARRAY[]::uuid[]; extra uuid[]; owner_id uuid; group_id_value uuid;
BEGIN
  prior := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  current_row := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  row_data := coalesce(current_row, prior);
  IF TG_OP = 'UPDATE' AND (prior - 'updated_at') IS NOT DISTINCT FROM (current_row - 'updated_at') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'UPDATE' AND ROW(OLD.name, OLD.preferred_locale, OLD.group_id) IS NOT DISTINCT FROM ROW(NEW.name, NEW.preferred_locale, NEW.group_id) THEN RETURN NEW; END IF;
    affected := ARRAY[(row_data->>'id')::uuid];
    SELECT array_agg(p.id) INTO extra FROM profiles p JOIN group_members m ON m.group_id = p.group_id
      WHERE p.type = 'group' AND m.profile_id = (row_data->>'id')::uuid;
    affected := affected || coalesce(extra, ARRAY[]::uuid[]);
  ELSIF TG_TABLE_NAME IN ('groups', 'group_members', 'group_top_of_mind_proposals', 'group_top_of_mind_affirmations') THEN
    IF TG_TABLE_NAME = 'groups' THEN
      IF TG_OP = 'UPDATE' AND ROW(OLD.name, OLD.created_by_profile_id) IS NOT DISTINCT FROM ROW(NEW.name, NEW.created_by_profile_id) THEN RETURN NEW; END IF;
      group_id_value := (row_data->>'id')::uuid;
    ELSIF TG_TABLE_NAME = 'group_top_of_mind_affirmations' THEN
      SELECT group_id INTO group_id_value FROM group_top_of_mind_proposals WHERE id = (row_data->>'proposal_id')::uuid;
    ELSE group_id_value := (row_data->>'group_id')::uuid; END IF;
    SELECT array_agg(id) INTO affected FROM profiles WHERE type = 'group' AND group_id = group_id_value;
  ELSIF TG_TABLE_NAME = 'top_of_minds' THEN
    owner_id := (row_data->>'profile_id')::uuid;
    IF owner_id IS NULL THEN SELECT id INTO owner_id FROM profiles WHERE type = 'group' AND group_id = (row_data->>'group_id')::uuid; END IF;
    affected := ARRAY[owner_id];
  ELSIF TG_TABLE_NAME IN ('top_of_mind_entries', 'top_of_mind_entry_signals') THEN
    IF TG_TABLE_NAME = 'top_of_mind_entries' THEN
      SELECT coalesce(m.profile_id,p.id) INTO owner_id FROM top_of_minds m LEFT JOIN profiles p ON p.type = 'group' AND p.group_id = m.group_id
        WHERE m.id = (row_data->>'top_of_mind_id')::uuid;
    ELSE
      SELECT coalesce(m.profile_id,p.id) INTO owner_id FROM top_of_mind_entries e JOIN top_of_minds m ON m.id = e.top_of_mind_id
        LEFT JOIN profiles p ON p.type = 'group' AND p.group_id = m.group_id WHERE e.id = (row_data->>'entry_id')::uuid;
    END IF;
    affected := ARRAY[owner_id];
  ELSE
    affected := ARRAY[(prior->>'profile_id')::uuid, (current_row->>'profile_id')::uuid];
    IF TG_TABLE_NAME IN ('signals', 'signal_embeddings', 'signal_evidence') THEN
      owner_id := (row_data->>'profile_id')::uuid;
      IF EXISTS (SELECT 1 FROM profiles WHERE id = owner_id AND type = 'group') THEN
        IF TG_TABLE_NAME = 'signals' THEN
          IF coalesce(prior->>'input_policy','') <> 'group-public-v1' AND coalesce(current_row->>'input_policy','') <> 'group-public-v1' THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
          END IF;
        ELSIF NOT EXISTS (SELECT 1 FROM signals WHERE id = (row_data->>'signal_id')::uuid AND input_policy = 'group-public-v1') THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'feedback' THEN
      IF row_data->>'target_type' = 'signal' THEN SELECT profile_id INTO owner_id FROM signals WHERE id = (row_data->>'target_id')::uuid;
      ELSIF row_data->>'target_type' = 'principle' THEN SELECT profile_id INTO owner_id FROM principles WHERE id = (row_data->>'target_id')::uuid;
      ELSE SELECT coalesce(m.profile_id,p.id) INTO owner_id FROM top_of_mind_entries e JOIN top_of_minds m ON m.id = e.top_of_mind_id
        LEFT JOIN profiles p ON p.type = 'group' AND p.group_id = m.group_id WHERE e.id = (row_data->>'target_id')::uuid; END IF;
      affected := affected || ARRAY[owner_id];
    END IF;
  END IF;
  PERFORM advance_generation_revisions(affected);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER profiles_generation_revision AFTER INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER groups_generation_revision AFTER UPDATE OR DELETE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER group_members_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER group_proposals_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."group_top_of_mind_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER group_stances_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."group_top_of_mind_affirmations" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER signals_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."signals" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER signal_embeddings_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."signal_embeddings" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER evidence_generation_revision AFTER INSERT OR DELETE OR UPDATE OF profile_id, owner_profile_id, signal_id, inspiration_id, material ON "public"."signal_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER principles_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."principles" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER principle_signals_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."principle_signals" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER feedback_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER contradictions_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."signal_contradictions" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER artifacts_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."top_of_minds" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER entries_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."top_of_mind_entries" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER citations_generation_revision AFTER INSERT OR UPDATE OR DELETE ON "public"."top_of_mind_entry_signals" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
