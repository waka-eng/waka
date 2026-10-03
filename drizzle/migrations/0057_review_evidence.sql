CREATE TABLE "signal_review_evidence" (
	"profile_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"statement_revision" bigint NOT NULL,
	"answer_revision" integer NOT NULL,
	"source_count" integer NOT NULL,
	"question_context_included" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_review_evidence_pk" PRIMARY KEY("profile_id","signal_id","answer_id"),
	CONSTRAINT "signal_review_evidence_bounds" CHECK ("signal_review_evidence"."statement_revision">0 AND "signal_review_evidence"."answer_revision">0 AND "signal_review_evidence"."source_count" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "signal_review_evidence_sources" (
	"profile_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"material_revision" bigint NOT NULL,
	"referenced" boolean NOT NULL,
	CONSTRAINT "signal_review_evidence_sources_pk" PRIMARY KEY("profile_id","signal_id","answer_id","inspiration_id"),
	CONSTRAINT "review_evidence_source_revision" CHECK ("signal_review_evidence_sources"."material_revision">0)
);
--> statement-breakpoint
ALTER TABLE "signal_review_evidence" ADD CONSTRAINT "signal_review_evidence_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_review_evidence" ADD CONSTRAINT "signal_review_evidence_answer_fk" FOREIGN KEY ("profile_id","session_id","answer_id") REFERENCES "public"."review_answers"("profile_id","session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_review_evidence_sources" ADD CONSTRAINT "review_evidence_source_parent_fk" FOREIGN KEY ("profile_id","signal_id","answer_id") REFERENCES "public"."signal_review_evidence"("profile_id","signal_id","answer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_review_evidence_sources" ADD CONSTRAINT "review_evidence_source_answer_fk" FOREIGN KEY ("profile_id","answer_id","inspiration_id") REFERENCES "public"."review_answer_sources"("profile_id","answer_id","inspiration_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_review_evidence_answer_idx" ON "signal_review_evidence" USING btree ("profile_id","answer_id");--> statement-breakpoint
CREATE INDEX "review_evidence_source_origin_idx" ON "signal_review_evidence_sources" USING btree ("profile_id","inspiration_id");
--> statement-breakpoint
CREATE FUNCTION review_question_context_current(owner_id uuid, review_id uuid, response_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM review_answers a WHERE a.profile_id=owner_id AND a.session_id=review_id AND a.id=response_id
    AND a.deleted_at IS NULL AND a.context_invalidated_at IS NULL AND a.question IS NOT NULL
    AND a.source_count=(SELECT count(*) FROM review_answer_sources r WHERE r.profile_id=a.profile_id AND r.answer_id=a.id)
    AND NOT EXISTS (SELECT 1 FROM review_answer_sources r LEFT JOIN inspiration_revisions v
      ON v.profile_id=r.profile_id AND v.inspiration_id=r.inspiration_id
      WHERE r.profile_id=a.profile_id AND r.answer_id=a.id AND v.personal_revision IS DISTINCT FROM r.source_revision));
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE FUNCTION review_evidence_current(owner_id uuid, claim_id uuid, response_id uuid, expected_statement bigint DEFAULT NULL) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM signal_review_evidence e JOIN signals s ON s.profile_id=e.profile_id AND s.id=e.signal_id
    JOIN review_answers a ON a.profile_id=e.profile_id AND a.session_id=e.session_id AND a.id=e.answer_id
    JOIN profiles p ON p.id=e.profile_id AND p.type::text<>'group'
    WHERE e.profile_id=owner_id AND e.signal_id=claim_id AND e.answer_id=response_id
      AND e.statement_revision=coalesce(expected_statement,s.statement_revision) AND e.answer_revision=a.revision AND a.deleted_at IS NULL
      AND e.question_context_included=review_question_context_current(a.profile_id,a.session_id,a.id)
      AND e.source_count=(SELECT count(*) FROM review_answer_sources r WHERE r.profile_id=e.profile_id AND r.answer_id=e.answer_id)
      AND e.source_count=(SELECT count(*) FROM signal_review_evidence_sources r WHERE r.profile_id=e.profile_id AND r.signal_id=e.signal_id AND r.answer_id=e.answer_id)
      AND EXISTS (SELECT 1 FROM signal_review_evidence_sources r WHERE r.profile_id=e.profile_id AND r.signal_id=e.signal_id AND r.answer_id=e.answer_id AND r.referenced)
      AND NOT EXISTS (SELECT 1 FROM signal_review_evidence_sources r
        LEFT JOIN inspiration_revisions v ON v.profile_id=r.profile_id AND v.inspiration_id=r.inspiration_id
        LEFT JOIN review_answer_sources a_source ON a_source.profile_id=r.profile_id AND a_source.answer_id=r.answer_id AND a_source.inspiration_id=r.inspiration_id
        WHERE r.profile_id=e.profile_id AND r.signal_id=e.signal_id AND r.answer_id=e.answer_id
          AND (v.personal_revision IS DISTINCT FROM r.material_revision OR a_source.referenced IS DISTINCT FROM r.referenced)));
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE FUNCTION signal_support_edges(claim_id uuid, expected_statement bigint DEFAULT NULL)
RETURNS TABLE(signal_id uuid, unit_id text, kind text, origin_id uuid, created_at timestamptz, source text, current boolean) AS $$
  SELECT e.signal_id, i.id::text, 'inspiration'::text, i.id, i.created_at, i.source::text,
    coalesce(e.statement_revision,1)=coalesce(expected_statement,s.statement_revision)
    AND coalesce(e.material_revision::numeric,CASE WHEN e.material->>'policy'='inspiration-material-v1'
      AND e.material->>'revision' ~ '^[1-9][0-9]*$' THEN (e.material->>'revision')::numeric END,1)
      =CASE WHEN e.profile_id=e.owner_profile_id THEN v.personal_revision ELSE v.public_revision END
  FROM signal_evidence e JOIN signals s ON s.profile_id=e.profile_id AND s.id=e.signal_id
  JOIN inspirations i ON i.profile_id=e.owner_profile_id AND i.id=e.inspiration_id
  LEFT JOIN inspiration_revisions v ON v.profile_id=i.profile_id AND v.inspiration_id=i.id WHERE e.signal_id=claim_id
  UNION ALL
  SELECT e.signal_id, a.session_id::text, 'review'::text, r.inspiration_id, a.created_at, 'app'::text,
    review_evidence_current(e.profile_id,e.signal_id,e.answer_id,expected_statement)
  FROM signal_review_evidence e JOIN review_answers a ON a.profile_id=e.profile_id AND a.session_id=e.session_id AND a.id=e.answer_id
  LEFT JOIN signal_review_evidence_sources r ON r.profile_id=e.profile_id AND r.signal_id=e.signal_id AND r.answer_id=e.answer_id AND r.referenced
  WHERE e.signal_id=claim_id;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE FUNCTION independent_evidence_count(edges jsonb, stop_after integer DEFAULT NULL) RETURNS integer AS $$
DECLARE adjacency jsonb; units text[]; unit text; item text; origin text; previous text; next_origin text; old_origin text;
  matches jsonb := '{}'::jsonb; unit_origins jsonb := '{}'::jsonb; parents jsonb; queue text[]; visited text[]; position integer; found boolean; result integer := 0;
BEGIN
  IF stop_after IS NOT NULL AND stop_after<1 THEN RAISE EXCEPTION 'Invalid evidence count bound' USING ERRCODE='22023'; END IF;
  SELECT jsonb_object_agg(k,origins),array_agg(k ORDER BY priority,k) INTO adjacency,units FROM (
    SELECT (r->>'kind')||':'||(r->>'unit') AS k,
      CASE WHEN r->>'kind'='inspiration' THEN 0 ELSE 1 END AS priority,
      jsonb_agg(DISTINCT r->>'origin' ORDER BY r->>'origin') AS origins
    FROM jsonb_array_elements(coalesce(edges,'[]'::jsonb)) r
    WHERE r->>'unit' IS NOT NULL AND r->>'origin' IS NOT NULL
    GROUP BY r->>'kind',r->>'unit'
  ) grouped;
  IF units IS NULL THEN RETURN 0; END IF;
  FOREACH unit IN ARRAY units LOOP
    queue:=ARRAY[unit];visited:=ARRAY[]::text[];parents:='{}'::jsonb;position:=1;found:=false;
    WHILE position<=cardinality(queue) AND NOT found LOOP
      item:=queue[position];position:=position+1;
      FOR origin IN SELECT jsonb_array_elements_text(adjacency->item) LOOP
        IF origin=ANY(visited) THEN CONTINUE; END IF;
        visited:=array_append(visited,origin);parents:=jsonb_set(parents,ARRAY[origin],to_jsonb(item),true);
        previous:=matches->>origin;
        IF previous IS NOT NULL THEN queue:=array_append(queue,previous);CONTINUE; END IF;
        next_origin:=origin;
        WHILE next_origin IS NOT NULL LOOP
          item:=parents->>next_origin;old_origin:=unit_origins->>item;
          matches:=jsonb_set(matches,ARRAY[next_origin],to_jsonb(item),true);
          unit_origins:=jsonb_set(unit_origins,ARRAY[item],to_jsonb(next_origin),true);next_origin:=old_origin;
        END LOOP;
        result:=result+1;IF stop_after IS NOT NULL AND result>=stop_after THEN RETURN result; END IF;found:=true;EXIT;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_signal_has_evidence() RETURNS trigger AS $$
DECLARE n integer; target_revision bigint;
BEGIN
  IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    target_revision:=NEW.statement_revision;
    IF TG_OP='UPDATE' AND OLD.statement IS DISTINCT FROM NEW.statement AND target_revision=OLD.statement_revision THEN
      target_revision:=OLD.statement_revision+1;
    END IF;
    SELECT independent_evidence_count(jsonb_agg(jsonb_build_object('kind',e.kind,'unit',e.unit_id,'origin',e.origin_id)),3) INTO n
      FROM signal_support_edges(NEW.id,target_revision) e WHERE e.current AND e.origin_id IS NOT NULL;
    IF n<3 THEN RAISE EXCEPTION 'signal % cannot be promoted to active with % evidence (needs 3) — see docs/generation.md',NEW.id,n; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION assert_review_evidence_private() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=NEW.profile_id AND type::text<>'group') THEN
    RAISE EXCEPTION 'Review support belongs only to its owning personal profile' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER signal_review_evidence_private BEFORE INSERT OR UPDATE ON signal_review_evidence
FOR EACH ROW EXECUTE FUNCTION assert_review_evidence_private();
--> statement-breakpoint
CREATE TRIGGER signal_review_evidence_generation AFTER INSERT OR UPDATE OR DELETE ON signal_review_evidence
FOR EACH ROW EXECUTE FUNCTION owned_generation_revision();
--> statement-breakpoint
CREATE TRIGGER signal_review_sources_generation AFTER INSERT OR UPDATE OR DELETE ON signal_review_evidence_sources
FOR EACH ROW EXECUTE FUNCTION owned_generation_revision();
--> statement-breakpoint
CREATE FUNCTION review_support_generation_revision() RETURNS trigger AS $$
DECLARE owner_id uuid; response_id uuid;
BEGIN
  IF TG_TABLE_NAME='review_answers' THEN
    IF TG_OP='UPDATE' AND ROW(OLD.answer,OLD.revision,OLD.context_invalidated_at,OLD.deleted_at,OLD.question,OLD.connection)
      IS NOT DISTINCT FROM ROW(NEW.answer,NEW.revision,NEW.context_invalidated_at,NEW.deleted_at,NEW.question,NEW.connection) THEN RETURN NEW; END IF;
    IF TG_OP='DELETE' THEN owner_id:=OLD.profile_id;response_id:=OLD.id; ELSE owner_id:=NEW.profile_id;response_id:=NEW.id; END IF;
  ELSE
    IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
    IF TG_OP='DELETE' THEN owner_id:=OLD.profile_id;response_id:=OLD.answer_id; ELSE owner_id:=NEW.profile_id;response_id:=NEW.answer_id; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM signal_review_evidence WHERE profile_id=owner_id AND answer_id=response_id) THEN
    PERFORM advance_generation_revisions(ARRAY[owner_id]);
  END IF;
  IF TG_TABLE_NAME='review_answers' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.deleted_at IS NOT NULL THEN DELETE FROM signal_review_evidence WHERE profile_id=owner_id AND answer_id=response_id; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_answers_support_generation AFTER UPDATE OR DELETE ON review_answers
FOR EACH ROW EXECUTE FUNCTION review_support_generation_revision();
--> statement-breakpoint
CREATE TRIGGER review_sources_support_generation AFTER INSERT OR UPDATE OR DELETE ON review_answer_sources
FOR EACH ROW EXECUTE FUNCTION review_support_generation_revision();
--> statement-breakpoint
CREATE FUNCTION review_origin_generation_revision() RETURNS trigger AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.personal_revision=OLD.personal_revision THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM signal_review_evidence_sources e WHERE e.profile_id=OLD.profile_id AND e.inspiration_id=OLD.inspiration_id) THEN
    PERFORM advance_generation_revisions(ARRAY[OLD.profile_id]);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspiration_revision_review_generation AFTER UPDATE OR DELETE ON inspiration_revisions
FOR EACH ROW EXECUTE FUNCTION review_origin_generation_revision();
--> statement-breakpoint
CREATE FUNCTION protect_review_answer_revision() RETURNS trigger AS $$
BEGIN
  IF OLD.answer IS DISTINCT FROM NEW.answer THEN NEW.revision:=OLD.revision+1;NEW.updated_at:=clock_timestamp();
  ELSE NEW.revision:=OLD.revision; END IF;
  IF (NEW.question IS NOT NULL AND NEW.question IS DISTINCT FROM OLD.question)
    OR (NEW.connection IS NOT NULL AND NEW.connection IS DISTINCT FROM OLD.connection) THEN
    RAISE EXCEPTION 'Saved review questions cannot be replaced in place' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_answers_revision BEFORE UPDATE ON review_answers
FOR EACH ROW EXECUTE FUNCTION protect_review_answer_revision();
--> statement-breakpoint
CREATE FUNCTION protect_review_source_identity() RETURNS trigger AS $$
BEGIN
  IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Saved review source references are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_sources_identity BEFORE UPDATE ON review_answer_sources
FOR EACH ROW EXECUTE FUNCTION protect_review_source_identity();
