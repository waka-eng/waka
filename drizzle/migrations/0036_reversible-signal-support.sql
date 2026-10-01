ALTER TABLE "public"."signals" ADD COLUMN "support_retired_at" timestamptz;
--> statement-breakpoint
CREATE TABLE "public"."signal_support_reviews" (
  "review_id" uuid NOT NULL,
  "signal_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "owner_profile_id" uuid NOT NULL,
  "inspiration_id" uuid NOT NULL,
  "review_hash" text NOT NULL,
  "statement_hash" text NOT NULL,
  "material" jsonb NOT NULL,
  "verdict" text NOT NULL,
  "issue" text,
  "source_ids" uuid[] NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("review_id", "signal_id"),
  CONSTRAINT "signal_support_reviews_verdict_check" CHECK (verdict IN ('supported', 'unsupported', 'unresolved')),
  CONSTRAINT "signal_support_reviews_signal_fk" FOREIGN KEY ("profile_id", "signal_id") REFERENCES "public"."signals" ("profile_id", "id") ON DELETE CASCADE,
  CONSTRAINT "signal_support_reviews_source_fk" FOREIGN KEY ("owner_profile_id", "inspiration_id") REFERENCES "public"."inspirations" ("profile_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "signal_support_reviews_source_idx" ON "public"."signal_support_reviews"
  ("profile_id", "inspiration_id", "signal_id", "created_at" DESC);
--> statement-breakpoint
CREATE FUNCTION "public"."refuse_withdrawn_signal_evidence"() RETURNS trigger AS $$
DECLARE latest_verdict text;
BEGIN
  -- Wait for a concurrent support writer's signal lock before reading its
  -- decision. Checking before an INSERT's uniqueness/FK wait can see an old
  -- snapshot and otherwise admit a link just after withdrawal commits.
  PERFORM 1 FROM signals s WHERE s.profile_id = NEW.profile_id AND s.id = NEW.signal_id FOR KEY SHARE;
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
CREATE TRIGGER signal_evidence_refuse_withdrawn BEFORE INSERT OR UPDATE OF profile_id, owner_profile_id, signal_id, inspiration_id
  ON "public"."signal_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_withdrawn_signal_evidence"();
