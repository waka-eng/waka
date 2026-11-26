-- Normalization compares complete original wording, including non-Latin scripts.
-- Symbols-only saves retain their normalized symbols instead of sharing a blank key.
CREATE FUNCTION evidence_text_hash(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(coalesce(nullif(regexp_replace(
    lower(normalize(value, NFKC) COLLATE pg_catalog."und-x-icu"), '[^[:alnum:]]', '', 'g'), ''),
    nullif(regexp_replace(normalize(value, NFKC) COLLATE pg_catalog."und-x-icu", '[[:space:]]+', '', 'g'), '')), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
ALTER TABLE "inspirations" ADD COLUMN "evidence_text_hash" text GENERATED ALWAYS AS (evidence_text_hash("text")) STORED;
--> statement-breakpoint
-- One indexed source lookup per distinct current original. Ordinary notes use
-- their stored digest. Effective media text follows the app's owner-correction
-- rules; answered reflections can identify a source with no other material.
CREATE FUNCTION inspiration_evidence_material(owner uuid, origin uuid)
RETURNS TABLE(material_key text, growth_keys text[], origin_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(to_jsonb(parts.identity)::text, 'UTF8')), 'hex'),
    ARRAY(SELECT DISTINCT key FROM unnest(parts.identity || media.locations) AS key ORDER BY key), i.created_at
  FROM inspirations i
  CROSS JOIN LATERAL (
    WITH attached AS (
      SELECT type::text AS kind, enrichment_status::text AS state, enrichment_text AS body,
        transcript_correction AS correction, url
      FROM attachments WHERE profile_id=i.profile_id AND inspiration_id=i.id
    ), corrected AS (
      -- Same labelled scene extraction as attachment-material.ts. An image
      -- correction replaces OCR words while keeping the picture description.
      SELECT *, CASE WHEN kind::text='image' AND correction IS NOT NULL AND state='ready' THEN
        CASE WHEN body ~* '(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:'
          THEN btrim(regexp_replace(coalesce(
            (regexp_match(body, '^(?:(?!(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:).)*(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:(?:[[:blank:]>#*_]*|(?:(?!(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*image[[:blank:]*_]*:).)*(?:\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*)image[[:blank:]*_]*:[[:blank:]*_]*(.*)$', 'i'))[1],
            (regexp_match(body, '(?:^|\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*image[[:blank:]*_]*:[[:blank:]*_]*((?:(?!(?:\n|(?<=[.!?"”''])[[:blank:]]+)[[:blank:]>#*_]*words[[:blank:]*_]*:).)*)', 'i'))[1], ''), '^[[:space:]*_]+|[[:space:]*_]+$', '', 'g'))
          ELSE btrim(body) END
        END AS scene
      FROM attached
    ), keys AS (
      SELECT evidence_text_hash(CASE
        WHEN kind::text='image' AND correction IS NOT NULL THEN 'Words: ' || correction ||
          CASE WHEN nullif(scene,'') IS NULL THEN '' ELSE chr(10) || 'Image: ' || scene END
        WHEN kind::text='audio' AND correction IS NOT NULL THEN correction
        WHEN state='ready' THEN body END) AS words,
        CASE WHEN kind='link' THEN 'url:' || encode(sha256(convert_to(nullif(btrim(url),''),'UTF8')),'hex') END AS location
      FROM corrected
    )
    SELECT ARRAY(SELECT DISTINCT coalesce(words,location) FROM keys WHERE coalesce(words,location) IS NOT NULL ORDER BY 1) AS contents,
      ARRAY(SELECT DISTINCT location FROM keys WHERE location IS NOT NULL ORDER BY 1) AS locations
  ) media
  CROSS JOIN LATERAL (
    SELECT CASE WHEN i.evidence_text_hash IS NULL AND cardinality(media.contents)=0 THEN
      ARRAY(SELECT DISTINCT h FROM (SELECT evidence_text_hash(answer) AS h FROM reflections
        WHERE profile_id=i.profile_id AND inspiration_id=i.id AND NOT skipped) replies WHERE h IS NOT NULL ORDER BY h)
    ELSE ARRAY(SELECT DISTINCT key FROM unnest(array_prepend(i.evidence_text_hash, media.contents)) AS key WHERE key IS NOT NULL ORDER BY key) END AS identity
  ) parts
  WHERE i.profile_id=owner AND i.id=origin AND i.memory_excluded_at IS NULL AND cardinality(parts.identity)>0
$$;
--> statement-breakpoint
-- Keep real source IDs for citations. A separate identity drives witness
-- counting. Avoid resolving the same source again for multiple signals.
CREATE FUNCTION signal_material_edges(owner uuid, claims uuid[], expected_statement bigint DEFAULT NULL)
RETURNS TABLE(signal_id uuid, unit_id text, kind text, origin_id uuid, created_at timestamptz, source text,
  current boolean, material_key text, growth_keys text[], origin_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH scope AS MATERIALIZED (
    SELECT type::text='group' AS is_group FROM profiles WHERE id=owner
  ), edges AS MATERIALIZED (
    SELECT e.* FROM signals s CROSS JOIN LATERAL signal_support_edges(s.id,expected_statement) e
    WHERE s.profile_id=owner AND s.id=ANY(claims)
  ), origins AS MATERIALIZED (
    SELECT DISTINCT e.origin_id FROM edges e CROSS JOIN scope WHERE NOT scope.is_group AND e.current IS TRUE AND e.origin_id IS NOT NULL
  ), materials AS MATERIALIZED (
    SELECT o.origin_id,m.* FROM origins o CROSS JOIN LATERAL inspiration_evidence_material(owner,o.origin_id) m
  )
  SELECT e.*, CASE WHEN scope.is_group THEN e.origin_id::text ELSE m.material_key END,
    CASE WHEN scope.is_group THEN ARRAY[]::text[] ELSE m.growth_keys END,
    CASE WHEN scope.is_group THEN e.created_at ELSE m.origin_at END
  FROM edges e CROSS JOIN scope LEFT JOIN materials m ON m.origin_id=e.origin_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_signal_has_evidence() RETURNS trigger AS $$
DECLARE n integer; target_revision bigint;
BEGIN
  IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    target_revision:=NEW.statement_revision;
    IF TG_OP='UPDATE' AND OLD.statement IS DISTINCT FROM NEW.statement AND target_revision=OLD.statement_revision THEN
      target_revision:=OLD.statement_revision+1;
    END IF;
    SELECT independent_evidence_count(jsonb_agg(jsonb_build_object('kind',e.kind,'unit',e.unit_id,'origin',e.material_key)),3) INTO n
    FROM signal_material_edges(NEW.profile_id,ARRAY[NEW.id],target_revision) e WHERE e.current AND e.material_key IS NOT NULL;
    IF n<3 THEN RAISE EXCEPTION 'signal % cannot be promoted to active with % evidence (needs 3) — see docs/generation.md',NEW.id,n; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
