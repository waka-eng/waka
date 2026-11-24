ALTER TABLE "embedding_index_work" ADD COLUMN "pending_embedding" jsonb;--> statement-breakpoint
ALTER TABLE "embedding_index_work" ADD CONSTRAINT "embedding_index_work_pending_embedding" CHECK ("embedding_index_work"."pending_embedding" IS NULL OR (
  "embedding_index_work"."requested_version">"embedding_index_work"."completed_version" AND jsonb_typeof("embedding_index_work"."pending_embedding")='object'
  AND coalesce("embedding_index_work"."pending_embedding"->>'attemptId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
  AND CASE WHEN jsonb_typeof("embedding_index_work"."pending_embedding"->'values')='array'
    THEN jsonb_array_length("embedding_index_work"."pending_embedding"->'values')=768 ELSE false END
  AND octet_length("embedding_index_work"."pending_embedding"::text)<=24576));--> statement-breakpoint
-- Dirty/version changes discard only the known received vector for this cell.
-- An unresolved legacy or transport attempt without a checkpoint is untouched.
CREATE FUNCTION "public"."discard_embedding_index_checkpoint"() RETURNS trigger
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
BEGIN
 UPDATE embedding_index_attempts
 SET status='stale'
 WHERE id=(OLD.pending_embedding->>'attemptId')::uuid
   AND profile_id=OLD.profile_id AND space=OLD.space AND source_kind=OLD.source_kind
   AND source_id=OLD.source_id AND input_scope=OLD.input_scope
   AND dispatch_family='index' AND purpose='live' AND status='received'
   AND request_key ~ ('^index:live:'||OLD.id::text||':'||OLD.requested_version::text||':[0-9]+:[123]$')
   AND account_id=(SELECT account_id FROM profiles WHERE id=OLD.profile_id);
 NEW.pending_embedding:=NULL;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER discard_embedding_index_checkpoint
 BEFORE UPDATE OF requested_version, pending_embedding ON "public"."embedding_index_work"
 FOR EACH ROW WHEN (OLD.pending_embedding IS NOT NULL
   AND (OLD.requested_version IS DISTINCT FROM NEW.requested_version OR NEW.pending_embedding IS NULL))
 EXECUTE FUNCTION "public"."discard_embedding_index_checkpoint"();
--> statement-breakpoint
-- A pending result belongs to the policy which admitted its dispatch.
CREATE FUNCTION "public"."discard_embedding_index_policy_checkpoints"() RETURNS trigger
LANGUAGE plpgsql SET search_path="public",pg_temp AS $$
BEGIN
 UPDATE embedding_index_work SET pending_embedding=NULL
 WHERE profile_id=NEW.profile_id AND pending_embedding IS NOT NULL;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER discard_embedding_index_policy_checkpoints
 AFTER UPDATE OF active_space, active_epoch, active_threshold_policy ON "public"."profile_embedding_indexes"
 FOR EACH ROW WHEN (OLD.active_space IS DISTINCT FROM NEW.active_space
   OR OLD.active_epoch IS DISTINCT FROM NEW.active_epoch
   OR OLD.active_threshold_policy IS DISTINCT FROM NEW.active_threshold_policy)
 EXECUTE FUNCTION "public"."discard_embedding_index_policy_checkpoints"();
