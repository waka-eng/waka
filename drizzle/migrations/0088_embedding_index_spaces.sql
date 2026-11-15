ALTER TYPE "public"."background_job_type" ADD VALUE 'index_embedding';--> statement-breakpoint
CREATE SEQUENCE "public"."embedding_index_work_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "embedding_index_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"dispatch_family" text DEFAULT 'index' NOT NULL,
	"purpose" text NOT NULL,
	"manifest_hash" text,
	"space" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"input_scope" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_bytes" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"http_status" integer,
	"input_tokens" integer,
	"reported_cost_usd" numeric,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "embedding_index_attempts_hash" CHECK ("embedding_index_attempts"."input_hash" ~ '^[a-f0-9]{64}$' AND ("embedding_index_attempts"."manifest_hash" IS NULL OR "embedding_index_attempts"."manifest_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "embedding_index_attempts_family" CHECK ("embedding_index_attempts"."dispatch_family" IN ('index','discovery') AND ("embedding_index_attempts"."source_kind"<>'review_answer' OR "embedding_index_attempts"."dispatch_family"='discovery')),
	CONSTRAINT "embedding_index_attempts_purpose" CHECK (("embedding_index_attempts"."purpose"='live' AND "embedding_index_attempts"."manifest_hash" IS NULL) OR ("embedding_index_attempts"."purpose"='migration' AND "embedding_index_attempts"."manifest_hash" IS NOT NULL)),
	CONSTRAINT "embedding_index_attempts_source" CHECK (("embedding_index_attempts"."source_kind"='inspiration' AND "embedding_index_attempts"."input_scope" IN ('personal','public')) OR ("embedding_index_attempts"."source_kind" IN ('signal','review_answer') AND "embedding_index_attempts"."input_scope"='statement')),
	CONSTRAINT "embedding_index_attempts_status" CHECK ("embedding_index_attempts"."status" IN ('reserved','received','committed','http_failed','unknown','stale')),
	CONSTRAINT "embedding_index_attempts_numeric" CHECK ("embedding_index_attempts"."input_bytes">=0 AND ("embedding_index_attempts"."http_status" IS NULL OR "embedding_index_attempts"."http_status" BETWEEN 100 AND 599) AND ("embedding_index_attempts"."input_tokens" IS NULL OR "embedding_index_attempts"."input_tokens">=0) AND ("embedding_index_attempts"."reported_cost_usd" IS NULL OR "embedding_index_attempts"."reported_cost_usd">=0))
);
--> statement-breakpoint
CREATE TABLE "embedding_index_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"space" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"input_scope" text NOT NULL,
	"requested_version" bigint DEFAULT nextval('embedding_index_work_version_seq') NOT NULL,
	"completed_version" bigint DEFAULT 0 NOT NULL,
	"completed_input_hash" text,
	"outcome" text,
	"failure_code" text,
	"job_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_index_work_versions" CHECK ("embedding_index_work"."requested_version">0 AND "embedding_index_work"."completed_version">=0 AND "embedding_index_work"."completed_version"<="embedding_index_work"."requested_version"),
	CONSTRAINT "embedding_index_work_source" CHECK (("embedding_index_work"."source_kind"='inspiration' AND "embedding_index_work"."input_scope" IN ('personal','public')) OR ("embedding_index_work"."source_kind"='signal' AND "embedding_index_work"."input_scope"='statement')),
	CONSTRAINT "embedding_index_work_space" CHECK ("embedding_index_work"."space" IN ('gemini-embedding-001','waka.embedding.gemini-2.text-retrieval.v1.768.raw')),
	CONSTRAINT "embedding_index_work_hash" CHECK ("embedding_index_work"."completed_input_hash" IS NULL OR "embedding_index_work"."completed_input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "embedding_index_work_outcome" CHECK ("embedding_index_work"."outcome" IS NULL OR "embedding_index_work"."outcome" IN ('current','ineligible','failed'))
);
--> statement-breakpoint
CREATE TABLE "profile_embedding_indexes" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"active_space" text DEFAULT 'gemini-embedding-001' NOT NULL,
	"active_epoch" bigint DEFAULT 0 NOT NULL,
	"active_threshold_policy" text DEFAULT 'gemini-embedding-001.thresholds.v1' NOT NULL,
	"building_space" text,
	"building_threshold_policy" text,
	"cutover_covered_version" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_embedding_indexes_spaces" CHECK ("profile_embedding_indexes"."active_space" IN ('gemini-embedding-001','waka.embedding.gemini-2.text-retrieval.v1.768.raw') AND ("profile_embedding_indexes"."building_space" IS NULL OR "profile_embedding_indexes"."building_space" IN ('gemini-embedding-001','waka.embedding.gemini-2.text-retrieval.v1.768.raw'))),
	CONSTRAINT "profile_embedding_indexes_epochs" CHECK ("profile_embedding_indexes"."active_epoch">=0 AND ("profile_embedding_indexes"."cutover_covered_version" IS NULL OR "profile_embedding_indexes"."cutover_covered_version">=0)),
	CONSTRAINT "profile_embedding_indexes_build" CHECK (("profile_embedding_indexes"."building_space" IS NULL)=("profile_embedding_indexes"."building_threshold_policy" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "embedding_index_attempts" ADD CONSTRAINT "embedding_index_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_index_work" ADD CONSTRAINT "embedding_index_work_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_embedding_indexes" ADD CONSTRAINT "profile_embedding_indexes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_index_attempts_request" ON "embedding_index_attempts" USING btree ("account_id","request_key");--> statement-breakpoint
CREATE INDEX "embedding_index_attempts_manifest" ON "embedding_index_attempts" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "embedding_index_attempts_account" ON "embedding_index_attempts" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_index_work_identity" ON "embedding_index_work" USING btree ("profile_id","space","source_kind","source_id","input_scope");--> statement-breakpoint
CREATE INDEX "embedding_index_work_pending" ON "embedding_index_work" USING btree ("profile_id","space","source_kind","input_scope") WHERE "embedding_index_work"."requested_version">"embedding_index_work"."completed_version";--> statement-breakpoint
CREATE INDEX "embedding_index_work_latest" ON "embedding_index_work" USING btree ("profile_id","space","requested_version" DESC NULLS LAST);
--> statement-breakpoint
CREATE FUNCTION "public"."embedding_index_shared_fence"(owner_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
BEGIN
 -- Always fence even an absent-control native001 writer, so registering a
 -- build cannot miss a transaction that began before the control row existed.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('waka.embedding-index:'||owner_id::text,0));
 IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=owner_id) THEN RETURN; END IF;
 INSERT INTO profile_embedding_indexes(profile_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 -- KEY SHARE is compatible between writers, not a hot-row UPDATE. In a stale
 -- repeatable-read snapshot, fail rather than silently missing a new policy.
 PERFORM 1 FROM profile_embedding_indexes WHERE profile_id=owner_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Embedding index policy snapshot changed' USING ERRCODE='40001'; END IF;
END; $$;
--> statement-breakpoint
CREATE FUNCTION "public"."embedding_index_before_source"() RETURNS trigger
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
DECLARE prior jsonb; current_row jsonb; owner_id uuid;
BEGIN
 prior:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 current_row:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 FOR owner_id IN SELECT DISTINCT value FROM unnest(CASE WHEN TG_TABLE_NAME='profiles'
   THEN ARRAY[(prior->>'id')::uuid,(current_row->>'id')::uuid]
   ELSE ARRAY[(prior->>'profile_id')::uuid,(current_row->>'profile_id')::uuid] END) value
   WHERE value IS NOT NULL ORDER BY value LOOP
  PERFORM embedding_index_shared_fence(owner_id);
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER embedding_index_source_fence BEFORE INSERT OR UPDATE OR DELETE ON "public"."inspirations" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE TRIGGER embedding_index_source_fence BEFORE INSERT OR UPDATE OR DELETE ON "public"."reflections" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE TRIGGER embedding_index_source_fence BEFORE INSERT OR UPDATE OR DELETE ON "public"."attachments" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE TRIGGER embedding_index_source_fence BEFORE INSERT OR UPDATE OR DELETE ON "public"."signals" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE TRIGGER embedding_index_vector_fence BEFORE INSERT OR UPDATE OR DELETE ON "public"."signal_embeddings" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE TRIGGER embedding_index_vector_fence BEFORE INSERT OR UPDATE OR DELETE ON "public"."inspiration_embeddings" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE TRIGGER embedding_index_profile_delete_fence BEFORE DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_before_source"();
--> statement-breakpoint
CREATE FUNCTION "public"."embedding_index_request"(owner_id uuid,kind_value text,source_id_value uuid,scope_value text) RETURNS void
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
DECLARE active_value text; building_value text; work_id uuid; queue_id uuid; key_value text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=owner_id) THEN RETURN; END IF;
 SELECT active_space,building_space INTO active_value,building_value FROM profile_embedding_indexes WHERE profile_id=owner_id;
 IF NOT FOUND OR (active_value IS DISTINCT FROM 'waka.embedding.gemini-2.text-retrieval.v1.768.raw' AND building_value IS DISTINCT FROM 'waka.embedding.gemini-2.text-retrieval.v1.768.raw') THEN RETURN; END IF;
 INSERT INTO embedding_index_work(profile_id,space,source_kind,source_id,input_scope)
 VALUES(owner_id,'waka.embedding.gemini-2.text-retrieval.v1.768.raw',kind_value,source_id_value,scope_value)
 ON CONFLICT(profile_id,space,source_kind,source_id,input_scope) DO UPDATE SET
  requested_version=nextval('embedding_index_work_version_seq'),failure_code=NULL,updated_at=clock_timestamp()
 RETURNING id INTO work_id;
 IF active_value<>'waka.embedding.gemini-2.text-retrieval.v1.768.raw' THEN RETURN; END IF;
 key_value:='index_embedding:'||owner_id::text||':waka.embedding.gemini-2.text-retrieval.v1.768.raw:'||kind_value||':'||source_id_value::text;
 INSERT INTO background_jobs(profile_id,type,payload,max_attempts,idempotency_key)
 VALUES(owner_id,'index_embedding',jsonb_build_object('sourceKind',kind_value,'sourceId',source_id_value,'space','waka.embedding.gemini-2.text-retrieval.v1.768.raw'),3,key_value)
 ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
  request_version=background_jobs.request_version+1,
  status=CASE WHEN background_jobs.status IN ('succeeded','failed') THEN 'pending'::background_job_status ELSE background_jobs.status END,
  attempts=CASE WHEN background_jobs.status IN ('succeeded','failed') THEN 0 ELSE background_jobs.attempts END,
  run_after=CASE WHEN background_jobs.status IN ('succeeded','failed') THEN now() ELSE background_jobs.run_after END,
  locked_at=CASE WHEN background_jobs.status IN ('succeeded','failed') THEN NULL ELSE background_jobs.locked_at END,
  last_error=CASE WHEN background_jobs.status IN ('succeeded','failed') THEN NULL ELSE background_jobs.last_error END,
  rerun_requested=CASE WHEN background_jobs.status='running' THEN true WHEN background_jobs.status IN ('succeeded','failed') THEN false ELSE background_jobs.rerun_requested END,
  updated_at=clock_timestamp()
 RETURNING id INTO queue_id;
 UPDATE embedding_index_work SET job_id=queue_id WHERE id=work_id;
END; $$;
--> statement-breakpoint
CREATE FUNCTION "public"."embedding_index_dirty_source"() RETURNS trigger
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
DECLARE prior jsonb; current_row jsonb; row_value jsonb; parent_id uuid; owner_id uuid; source_kind_value text; public_needed boolean; relevant_keys text[]; key_value text; changed boolean;
BEGIN
 prior:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 current_row:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 IF NOT EXISTS (SELECT 1 FROM profile_embedding_indexes p WHERE p.profile_id IN ((prior->>'profile_id')::uuid,(current_row->>'profile_id')::uuid)
   AND (p.active_space='waka.embedding.gemini-2.text-retrieval.v1.768.raw' OR p.building_space='waka.embedding.gemini-2.text-retrieval.v1.768.raw')) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  relevant_keys:=CASE TG_TABLE_NAME
   WHEN 'inspirations' THEN ARRAY['profile_id','id','text','kind','visibility','memory_excluded_at','created_at']
   WHEN 'signals' THEN ARRAY['profile_id','id','statement']
   WHEN 'reflections' THEN ARRAY['profile_id','id','inspiration_id','question','answer','skipped','created_at']
   WHEN 'attachments' THEN ARRAY['profile_id','id','inspiration_id','type','enrichment_status','enrichment_text','transcript_correction','created_at'] END;
  changed:=false;
  FOREACH key_value IN ARRAY relevant_keys LOOP
   IF prior->key_value IS DISTINCT FROM current_row->key_value THEN changed:=true; EXIT; END IF;
  END LOOP;
  IF NOT changed THEN RETURN NEW; END IF;
 END IF;
 -- Deduplicate OLD/NEW identity so one logical event does not double-bump work.
 FOR row_value IN SELECT DISTINCT value FROM jsonb_array_elements(jsonb_build_array(prior,current_row)) value WHERE value<>'null'::jsonb LOOP
  owner_id:=(row_value->>'profile_id')::uuid;
  parent_id:=CASE WHEN TG_TABLE_NAME IN ('inspirations','signals') THEN (row_value->>'id')::uuid ELSE (row_value->>'inspiration_id')::uuid END;
  IF owner_id IS NULL OR parent_id IS NULL THEN CONTINUE; END IF;
  source_kind_value:=CASE WHEN TG_TABLE_NAME='signals' THEN 'signal' ELSE 'inspiration' END;
  -- Skip duplicate identity for UPDATE; changed content still yields ONE event.
  IF TG_OP='UPDATE' AND row_value=prior AND (prior->>'profile_id')=(current_row->>'profile_id') AND
    (CASE WHEN TG_TABLE_NAME IN ('inspirations','signals') THEN prior->>'id' ELSE prior->>'inspiration_id' END)=
    (CASE WHEN TG_TABLE_NAME IN ('inspirations','signals') THEN current_row->>'id' ELSE current_row->>'inspiration_id' END) THEN CONTINUE; END IF;
  IF TG_TABLE_NAME='signals' THEN PERFORM embedding_index_request(owner_id,source_kind_value,parent_id,'statement'); CONTINUE; END IF;
  PERFORM embedding_index_request(owner_id,'inspiration',parent_id,'personal');
  IF TG_TABLE_NAME='reflections' THEN CONTINUE; END IF;
  public_needed:=EXISTS(SELECT 1 FROM inspirations i WHERE i.profile_id=owner_id AND i.id=parent_id AND i.visibility='public')
    OR (TG_TABLE_NAME='inspirations' AND (prior->>'visibility'='public' OR current_row->>'visibility'='public'))
    OR EXISTS(SELECT 1 FROM embedding_index_work w WHERE w.profile_id=owner_id AND w.source_id=parent_id AND w.source_kind='inspiration' AND w.input_scope='public');
  IF public_needed THEN PERFORM embedding_index_request(owner_id,'inspiration',parent_id,'public'); END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER zz_embedding_index_dirty AFTER INSERT OR UPDATE OR DELETE ON "public"."inspirations" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_dirty_source"();
--> statement-breakpoint
CREATE TRIGGER zz_embedding_index_dirty AFTER INSERT OR UPDATE OR DELETE ON "public"."reflections" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_dirty_source"();
--> statement-breakpoint
CREATE TRIGGER zz_embedding_index_dirty AFTER INSERT OR UPDATE OR DELETE ON "public"."attachments" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_dirty_source"();
--> statement-breakpoint
CREATE TRIGGER zz_embedding_index_dirty AFTER INSERT OR UPDATE OR DELETE ON "public"."signals" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_index_dirty_source"();
--> statement-breakpoint
CREATE FUNCTION "public"."embedding_space_is_active"(owner_id uuid,model_value text) RETURNS boolean
LANGUAGE sql STABLE SET search_path="public",pg_temp AS $$
 SELECT model_value=coalesce((SELECT active_space FROM profile_embedding_indexes WHERE profile_id=owner_id),'gemini-embedding-001');
$$;
--> statement-breakpoint
DROP TRIGGER signal_embeddings_generation_revision ON "public"."signal_embeddings";
--> statement-breakpoint
CREATE TRIGGER signal_embeddings_generation_revision_insert AFTER INSERT ON "public"."signal_embeddings" FOR EACH ROW
 WHEN ("public"."embedding_space_is_active"(NEW.profile_id,NEW.model)) EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER signal_embeddings_generation_revision_update AFTER UPDATE ON "public"."signal_embeddings" FOR EACH ROW
 WHEN ("public"."embedding_space_is_active"(OLD.profile_id,OLD.model) OR "public"."embedding_space_is_active"(NEW.profile_id,NEW.model)) EXECUTE FUNCTION "public"."owned_generation_revision"();
--> statement-breakpoint
CREATE TRIGGER signal_embeddings_generation_revision_delete AFTER DELETE ON "public"."signal_embeddings" FOR EACH ROW
 WHEN ("public"."embedding_space_is_active"(OLD.profile_id,OLD.model)) EXECUTE FUNCTION "public"."owned_generation_revision"();

--> statement-breakpoint
ALTER TABLE "public"."profile_embedding_indexes" ADD CONSTRAINT "profile_embedding_indexes_threshold" CHECK (("profile_embedding_indexes"."active_space"='gemini-embedding-001' AND "profile_embedding_indexes"."active_threshold_policy"='gemini-embedding-001.thresholds.v1') OR ("profile_embedding_indexes"."active_space"<>'gemini-embedding-001' AND "profile_embedding_indexes"."active_threshold_policy"<>'embedding2.unvalidated'));

--> statement-breakpoint
ALTER TABLE "public"."embedding_index_work" ADD CONSTRAINT "embedding_index_work_complete" CHECK (("embedding_index_work"."completed_version"=0 OR "embedding_index_work"."outcome" IS NOT NULL) AND ("embedding_index_work"."outcome"<>'current' OR "embedding_index_work"."completed_input_hash" IS NOT NULL) AND ("embedding_index_work"."outcome"<>'ineligible' OR "embedding_index_work"."completed_input_hash" IS NULL));

--> statement-breakpoint
CREATE INDEX "embedding_index_attempts_unresolved_source" ON "public"."embedding_index_attempts" USING btree ("account_id","profile_id","space","source_kind","source_id","input_scope","dispatch_family") WHERE "embedding_index_attempts"."status" IN ('reserved','received','unknown');
