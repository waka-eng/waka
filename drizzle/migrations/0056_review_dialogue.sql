ALTER TYPE "public"."background_job_type" ADD VALUE 'generate_review_question';--> statement-breakpoint
CREATE TABLE "review_answer_sources" (
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"inspiration_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"referenced" boolean NOT NULL,
	CONSTRAINT "review_answer_sources_profile_id_answer_id_inspiration_id_pk" PRIMARY KEY("profile_id","answer_id","inspiration_id"),
	CONSTRAINT "review_answer_sources_revision_check" CHECK ("review_answer_sources"."source_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "review_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"question_job_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"question" text,
	"connection" text,
	"answer" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_count" integer NOT NULL,
	"context_invalidated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_answers_owner_identity" UNIQUE("profile_id","session_id","id"),
	CONSTRAINT "review_answers_question_unique" UNIQUE("profile_id","session_id","question_job_id"),
	CONSTRAINT "review_answers_bounds" CHECK ("review_answers"."revision" > 0 AND "review_answers"."source_count" BETWEEN 1 AND 5 AND (("review_answers"."deleted_at" IS NULL AND "review_answers"."answer" IS NOT NULL AND length(trim("review_answers"."answer")) > 0 AND length("review_answers"."answer") <= 16000) OR ("review_answers"."deleted_at" IS NOT NULL AND "review_answers"."answer" IS NULL AND "review_answers"."question" IS NULL AND "review_answers"."connection" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "review_answer_sources" ADD CONSTRAINT "review_answer_sources_answer_fk" FOREIGN KEY ("profile_id","session_id","answer_id") REFERENCES "public"."review_answers"("profile_id","session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_answer_sources" ADD CONSTRAINT "review_answer_sources_item_fk" FOREIGN KEY ("profile_id","session_id","inspiration_id") REFERENCES "public"."review_items"("profile_id","session_id","inspiration_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_session_fk" FOREIGN KEY ("profile_id","session_id") REFERENCES "public"."review_sessions"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_answer_sources_source_idx" ON "review_answer_sources" USING btree ("profile_id","inspiration_id");--> statement-breakpoint
CREATE INDEX "review_answers_session_idx" ON "review_answers" USING btree ("profile_id","session_id","created_at");
--> statement-breakpoint
CREATE FUNCTION "public"."invalidate_review_source_context"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.personal_revision = NEW.personal_revision THEN RETURN NEW; END IF;
  UPDATE review_answers a SET question = NULL, connection = NULL, context_invalidated_at = coalesce(a.context_invalidated_at, clock_timestamp())
    WHERE a.profile_id = OLD.profile_id AND EXISTS (SELECT 1 FROM review_sessions r WHERE r.profile_id = a.profile_id AND r.id = a.session_id) AND EXISTS (
      SELECT 1 FROM review_answer_sources s WHERE s.profile_id = a.profile_id AND s.answer_id = a.id AND s.inspiration_id = OLD.inspiration_id
    );
  UPDATE background_jobs SET payload = '{"reviewContextInvalidated":true}'::jsonb, status = CASE WHEN status = 'failed' THEN status ELSE 'succeeded'::background_job_status END, locked_at = NULL, last_error = NULL, rerun_requested = false, completed_version = GREATEST(completed_version, request_version), updated_at = clock_timestamp() WHERE profile_id = OLD.profile_id AND type::text = 'generate_review_question'
    AND payload->'inspirationIds' @> jsonb_build_array(OLD.inspiration_id::text)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = background_jobs.profile_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspiration_revisions_review_context BEFORE UPDATE OR DELETE ON "public"."inspiration_revisions"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_review_source_context"();
--> statement-breakpoint
CREATE FUNCTION "public"."invalidate_review_source_link"() RETURNS trigger AS $$
BEGIN
  UPDATE review_answers a SET question = NULL, connection = NULL, context_invalidated_at = coalesce(context_invalidated_at, clock_timestamp())
    WHERE a.profile_id = OLD.profile_id AND a.id = OLD.answer_id AND EXISTS (SELECT 1 FROM review_sessions r WHERE r.profile_id = a.profile_id AND r.id = a.session_id);
  UPDATE background_jobs SET payload = '{"reviewContextInvalidated":true}'::jsonb, status = CASE WHEN status = 'failed' THEN status ELSE 'succeeded'::background_job_status END, locked_at = NULL, last_error = NULL, rerun_requested = false, completed_version = GREATEST(completed_version, request_version), updated_at = clock_timestamp() WHERE profile_id = OLD.profile_id AND type::text = 'generate_review_question' AND payload->>'sessionId' = OLD.session_id::text
    AND payload->'inspirationIds' @> jsonb_build_array(OLD.inspiration_id::text)
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = background_jobs.profile_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_answer_sources_withdraw BEFORE DELETE ON "public"."review_answer_sources"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_review_source_link"();
--> statement-breakpoint
CREATE FUNCTION "public"."invalidate_review_answer_questions"() RETURNS trigger AS $$
DECLARE owner_id uuid; review_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.answer, OLD.revision) IS NOT DISTINCT FROM ROW(NEW.answer, NEW.revision) THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN owner_id := OLD.profile_id; review_id := OLD.session_id;
  ELSE owner_id := NEW.profile_id; review_id := NEW.session_id; END IF;
  IF TG_OP <> 'INSERT' THEN
    -- Later AI questions may quote or depend on the earlier answer. Keep
    -- later human words, but never retain the withdrawn machine premise.
    UPDATE review_answers a SET question = NULL, connection = NULL,
      context_invalidated_at = coalesce(a.context_invalidated_at, clock_timestamp())
      WHERE a.profile_id = owner_id AND a.session_id = review_id AND a.id <> OLD.id
        AND (a.created_at > OLD.created_at OR (a.created_at = OLD.created_at AND a.id > OLD.id))
        AND EXISTS (SELECT 1 FROM review_sessions r WHERE r.profile_id = a.profile_id AND r.id = a.session_id);
  END IF;
  UPDATE background_jobs SET payload = '{"reviewContextInvalidated":true}'::jsonb, status = CASE WHEN status = 'failed' THEN status ELSE 'succeeded'::background_job_status END, locked_at = NULL, last_error = NULL, rerun_requested = false, completed_version = GREATEST(completed_version, request_version), updated_at = clock_timestamp() WHERE profile_id = owner_id AND type::text = 'generate_review_question' AND payload->>'sessionId' = review_id::text
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = background_jobs.profile_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_answers_question_context AFTER INSERT OR UPDATE OR DELETE ON "public"."review_answers"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_review_answer_questions"();
--> statement-breakpoint
CREATE FUNCTION "public"."invalidate_review_selection_questions"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND coalesce(OLD.choice = 'keep', false) IS NOT DISTINCT FROM coalesce(NEW.choice = 'keep', false) THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND coalesce(OLD.choice = 'keep', false) = false THEN RETURN OLD; END IF;
  UPDATE background_jobs SET payload = '{"reviewContextInvalidated":true}'::jsonb, status = CASE WHEN status = 'failed' THEN status ELSE 'succeeded'::background_job_status END, locked_at = NULL, last_error = NULL, rerun_requested = false, completed_version = GREATEST(completed_version, request_version), updated_at = clock_timestamp() WHERE profile_id = OLD.profile_id AND type::text = 'generate_review_question' AND payload->>'sessionId' = OLD.session_id::text
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = background_jobs.profile_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_items_question_context BEFORE UPDATE OR DELETE ON "public"."review_items"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_review_selection_questions"();
--> statement-breakpoint
CREATE FUNCTION "public"."invalidate_review_session_questions"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.completed_at IS NOT DISTINCT FROM NEW.completed_at THEN RETURN NEW; END IF;
  UPDATE background_jobs SET payload = '{"reviewContextInvalidated":true}'::jsonb, status = CASE WHEN status = 'failed' THEN status ELSE 'succeeded'::background_job_status END, locked_at = NULL, last_error = NULL, rerun_requested = false, completed_version = GREATEST(completed_version, request_version), updated_at = clock_timestamp() WHERE profile_id = OLD.profile_id AND type::text = 'generate_review_question' AND payload->>'sessionId' = OLD.id::text
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = background_jobs.profile_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_sessions_question_context BEFORE UPDATE OR DELETE ON "public"."review_sessions"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_review_session_questions"();
