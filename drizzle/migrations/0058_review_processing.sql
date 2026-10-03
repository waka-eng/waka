ALTER TYPE "public"."background_job_type" ADD VALUE 'derive_review_answer';--> statement-breakpoint
CREATE TABLE "review_answer_processing" (
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"material_hash" text NOT NULL,
	"discovery_hash" text,
	"derivation_job_id" uuid,
	"derivation_request_version" bigint,
	"reading_job_id" uuid,
	"reading_request_version" bigint,
	"signal_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"result" jsonb,
	"derived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "review_answer_processing_pk" PRIMARY KEY("profile_id","answer_id"),
	CONSTRAINT "review_processing_bounds" CHECK (("review_answer_processing"."derivation_job_id" IS NULL OR ("review_answer_processing"."derivation_request_version" IS NOT NULL AND "review_answer_processing"."derivation_request_version">0)) AND ("review_answer_processing"."reading_job_id" IS NULL OR ("review_answer_processing"."reading_request_version" IS NOT NULL AND "review_answer_processing"."reading_request_version">0)) AND ("review_answer_processing"."completed_at" IS NULL OR ("review_answer_processing"."derived_at" IS NOT NULL AND "review_answer_processing"."result" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "review_signal_support" (
	"profile_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"answer_revision" integer NOT NULL,
	"statement_revision" bigint NOT NULL,
	"material_hash" text NOT NULL,
	"policy" text NOT NULL,
	"verdict" text NOT NULL,
	"last_explicit" text,
	"checked_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "review_signal_support_pk" PRIMARY KEY("profile_id","answer_id","signal_id"),
	CONSTRAINT "review_signal_support_bounds" CHECK ("review_signal_support"."answer_revision">0 AND "review_signal_support"."statement_revision">0 AND "review_signal_support"."verdict" IN ('supported','unsupported','unresolved') AND ("review_signal_support"."last_explicit" IS NULL OR "review_signal_support"."last_explicit" IN ('supported','unsupported')) AND ("review_signal_support"."verdict"='unresolved' OR ("review_signal_support"."last_explicit"="review_signal_support"."verdict") IS TRUE))
);
--> statement-breakpoint
ALTER TABLE "suppressions" ADD COLUMN "review_answer_id" uuid;--> statement-breakpoint
ALTER TABLE "review_answer_processing" ADD CONSTRAINT "review_answer_processing_derivation_job_id_background_jobs_id_fk" FOREIGN KEY ("derivation_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_answer_processing" ADD CONSTRAINT "review_answer_processing_reading_job_id_background_jobs_id_fk" FOREIGN KEY ("reading_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_answer_processing" ADD CONSTRAINT "review_processing_answer_fk" FOREIGN KEY ("profile_id","session_id","answer_id") REFERENCES "public"."review_answers"("profile_id","session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_signal_support" ADD CONSTRAINT "review_signal_support_answer_fk" FOREIGN KEY ("profile_id","session_id","answer_id") REFERENCES "public"."review_answers"("profile_id","session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_signal_support" ADD CONSTRAINT "review_signal_support_signal_fk" FOREIGN KEY ("profile_id","signal_id") REFERENCES "public"."signals"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_processing_reading_idx" ON "review_answer_processing" USING btree ("reading_job_id","reading_request_version");--> statement-breakpoint
CREATE INDEX "review_signal_support_signal_idx" ON "review_signal_support" USING btree ("profile_id","signal_id");--> statement-breakpoint
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_profile_identity" UNIQUE("profile_id","id");--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_one_source" CHECK ("suppressions"."inspiration_id" IS NULL OR "suppressions"."review_answer_id" IS NULL);
--> statement-breakpoint
ALTER TABLE suppressions ADD CONSTRAINT suppressions_review_answer_fk FOREIGN KEY(profile_id,review_answer_id)
REFERENCES review_answers(profile_id,id) ON DELETE SET NULL(review_answer_id);
--> statement-breakpoint
CREATE TRIGGER review_support_private BEFORE INSERT OR UPDATE ON review_signal_support FOR EACH ROW EXECUTE FUNCTION assert_review_evidence_private();
--> statement-breakpoint
CREATE TRIGGER review_processing_private BEFORE INSERT OR UPDATE ON review_answer_processing FOR EACH ROW EXECUTE FUNCTION assert_review_evidence_private();
--> statement-breakpoint
CREATE FUNCTION preserve_review_withdrawal() RETURNS trigger AS $$
BEGIN
  IF NEW.verdict='unresolved' THEN NEW.last_explicit:=OLD.last_explicit; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_support_withdrawal BEFORE UPDATE ON review_signal_support FOR EACH ROW EXECUTE FUNCTION preserve_review_withdrawal();
--> statement-breakpoint
CREATE FUNCTION refuse_withdrawn_review_evidence() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM review_signal_support r WHERE r.profile_id=NEW.profile_id AND r.answer_id=NEW.answer_id
    AND r.signal_id=NEW.signal_id AND r.last_explicit='unsupported') THEN
    RAISE EXCEPTION 'Review support needs an explicit positive reassessment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_evidence_withdrawal BEFORE INSERT OR UPDATE ON signal_review_evidence FOR EACH ROW EXECUTE FUNCTION refuse_withdrawn_review_evidence();
--> statement-breakpoint
CREATE FUNCTION request_review_answer_work(owner_id uuid, review_id uuid, response_id uuid)
RETURNS TABLE(job_id uuid,request_version bigint,created boolean) AS $$
DECLARE affected uuid[]; input_payload jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=owner_id AND p.type::text<>'group') THEN RETURN; END IF;
  SELECT array_agg(DISTINCT id) INTO affected FROM (
    SELECT e.signal_id AS id FROM signal_review_evidence e WHERE e.profile_id=owner_id AND e.answer_id=response_id
    UNION SELECT r.signal_id FROM review_signal_support r WHERE r.profile_id=owner_id AND r.answer_id=response_id
    UNION SELECT unnest(r.signal_ids) FROM review_answer_processing r WHERE r.profile_id=owner_id AND r.answer_id=response_id
  ) linked;
  input_payload:=jsonb_build_object('answerId',response_id,'sessionId',review_id,'signalIds',to_jsonb(coalesce(affected,ARRAY[]::uuid[])));
  RETURN QUERY INSERT INTO background_jobs AS j(profile_id,type,payload,max_attempts,idempotency_key,run_after)
    VALUES(owner_id,'derive_review_answer',input_payload,3,'derive_review_answer:'||owner_id::text||':'||response_id::text,now()+interval '5 seconds')
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
      request_version=j.request_version+1,
      status=CASE WHEN j.status IN ('succeeded','failed') THEN 'pending'::background_job_status ELSE j.status END,
      payload=jsonb_build_object('answerId',response_id,'sessionId',review_id,'signalIds',
        (SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(coalesce(j.payload->'signalIds','[]'::jsonb)||(input_payload->'signalIds')) value)),
      attempts=CASE WHEN j.status IN ('succeeded','failed') THEN 0 ELSE j.attempts END,
      run_after=CASE WHEN j.status IN ('succeeded','failed') THEN now()+interval '5 seconds' ELSE j.run_after END,
      locked_at=CASE WHEN j.status IN ('succeeded','failed') THEN NULL ELSE j.locked_at END,
      last_error=NULL,rerun_requested=CASE WHEN j.status='running' THEN true WHEN j.status IN ('succeeded','failed') THEN false ELSE j.rerun_requested END,
      updated_at=clock_timestamp()
    RETURNING j.id,j.request_version,(xmax=0);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION enqueue_changed_review_answer() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.deleted_at IS NULL THEN PERFORM request_review_answer_work(NEW.profile_id,NEW.session_id,NEW.id); END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(OLD.answer,OLD.deleted_at,OLD.question,OLD.connection,OLD.context_invalidated_at)
      IS NOT DISTINCT FROM ROW(NEW.answer,NEW.deleted_at,NEW.question,NEW.connection,NEW.context_invalidated_at) THEN RETURN NEW; END IF;
  END IF;
  PERFORM request_review_answer_work(OLD.profile_id,OLD.session_id,OLD.id);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_answer_work_insert AFTER INSERT ON review_answers FOR EACH ROW EXECUTE FUNCTION enqueue_changed_review_answer();
--> statement-breakpoint
CREATE TRIGGER review_answer_work_change BEFORE UPDATE OR DELETE ON review_answers FOR EACH ROW EXECUTE FUNCTION enqueue_changed_review_answer();
--> statement-breakpoint
CREATE FUNCTION enqueue_review_origin_change() RETURNS trigger AS $$
DECLARE target record;
BEGIN
  IF TG_TABLE_NAME='inspiration_revisions' THEN
    IF NEW.personal_revision=OLD.personal_revision THEN RETURN NEW; END IF;
    FOR target IN SELECT DISTINCT a.profile_id,a.session_id,a.id FROM review_answers a JOIN review_answer_sources r ON r.profile_id=a.profile_id AND r.answer_id=a.id
      WHERE r.profile_id=OLD.profile_id AND r.inspiration_id=OLD.inspiration_id AND a.deleted_at IS NULL LOOP
      PERFORM request_review_answer_work(target.profile_id,target.session_id,target.id);
    END LOOP;
    RETURN NEW;
  END IF;
  PERFORM request_review_answer_work(OLD.profile_id,OLD.session_id,OLD.answer_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_origin_work AFTER UPDATE ON inspiration_revisions FOR EACH ROW EXECUTE FUNCTION enqueue_review_origin_change();
--> statement-breakpoint
CREATE TRIGGER review_source_removed_work BEFORE DELETE ON review_answer_sources FOR EACH ROW EXECUTE FUNCTION enqueue_review_origin_change();
--> statement-breakpoint
CREATE FUNCTION settle_removed_review_support() RETURNS trigger AS $$
BEGIN
  UPDATE signals s SET confidence=0,last_evidence_at=NULL,
    status=CASE WHEN s.locked_at IS NULL THEN 'retired'::signal_status ELSE s.status END,
    unsupported_at=CASE WHEN s.locked_at IS NOT NULL THEN coalesce(s.unsupported_at,clock_timestamp()) ELSE NULL END,
    support_retired_at=CASE WHEN s.locked_at IS NULL THEN coalesce(s.support_retired_at,clock_timestamp()) ELSE NULL END,
    updated_at=clock_timestamp()
  WHERE s.profile_id=OLD.profile_id AND s.id=OLD.signal_id AND s.dismissed_at IS NULL AND s.status<>'retired'
    AND EXISTS(SELECT 1 FROM profiles p WHERE p.id=s.profile_id)
    AND NOT EXISTS(SELECT 1 FROM signal_evidence e WHERE e.signal_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM signal_review_evidence e WHERE e.signal_id=s.id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER review_support_removed AFTER DELETE ON signal_review_evidence FOR EACH ROW EXECUTE FUNCTION settle_removed_review_support();
