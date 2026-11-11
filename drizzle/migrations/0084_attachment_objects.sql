CREATE TABLE attachment_objects (
  key_hash text PRIMARY KEY,
  key text,
  storage_scope text,
  issued_profile_id uuid,
  upload_expires_at timestamptz,
  due_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  generation bigint NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX attachment_objects_due_idx ON attachment_objects(due_at);
--> statement-breakpoint
-- Same lock namespace as lockAttachmentKeys. INSERT/UPDATE takes this lock
-- before looking at closure, so a stale successful HEAD cannot rebind bytes
-- deleted by a concurrent worker. The no-op conflict UPDATE also enforces
-- current visibility / serialization failure under repeatable-read callers.
CREATE FUNCTION attachment_object_reference(k text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE closed timestamptz;
BEGIN
  IF k IS NULL OR k = '' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('waka.attachment-key:' || k, 0));
  INSERT INTO attachment_objects(key_hash) VALUES(encode(sha256(convert_to(k,'UTF8')),'hex'))
    ON CONFLICT(key_hash) DO UPDATE SET key_hash=EXCLUDED.key_hash
    RETURNING closed_at INTO closed;
  IF closed IS NOT NULL THEN
    RAISE EXCEPTION 'Attachment object is closed' USING ERRCODE='23514', CONSTRAINT='attachment_object_closed';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION attachment_object_cleanup(k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF k IS NULL OR k = '' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('waka.attachment-key:' || k, 0));
  INSERT INTO attachment_objects(key_hash,key,due_at)
    VALUES(encode(sha256(convert_to(k,'UTF8')),'hex'),k,now())
    ON CONFLICT(key_hash) DO UPDATE SET key=EXCLUDED.key,
      due_at=LEAST(attachment_objects.due_at,EXCLUDED.due_at),generation=attachment_objects.generation+1;
END $$;
--> statement-breakpoint
CREATE FUNCTION attachment_object_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; keys text[] := '{}';
BEGIN
  IF TG_OP <> 'INSERT' THEN keys := array_append(keys,OLD.s3_key); END IF;
  IF TG_OP <> 'DELETE' THEN keys := array_append(keys,NEW.s3_key); END IF;
  FOR k IN SELECT DISTINCT unnest(keys) ORDER BY 1 LOOP
    IF k IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('waka.attachment-key:' || k, 0)); END IF;
  END LOOP;
  IF TG_OP <> 'DELETE' THEN PERFORM attachment_object_reference(NEW.s3_key); END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.s3_key IS DISTINCT FROM NEW.s3_key) THEN
    PERFORM attachment_object_cleanup(OLD.s3_key);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER attachment_object_row_change BEFORE INSERT OR UPDATE OF s3_key OR DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION attachment_object_row_change();
--> statement-breakpoint
CREATE FUNCTION attachment_object_copy_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; old_keys text[] := '{}'; new_keys text[] := '{}';
BEGIN
  IF TG_OP <> 'INSERT' THEN SELECT ARRAY(SELECT DISTINCT x->>'s3Key' FROM jsonb_array_elements(OLD.attachments) x WHERE x->>'s3Key' IS NOT NULL) INTO old_keys; END IF;
  IF TG_OP <> 'DELETE' THEN SELECT ARRAY(SELECT DISTINCT x->>'s3Key' FROM jsonb_array_elements(NEW.attachments) x WHERE x->>'s3Key' IS NOT NULL) INTO new_keys; END IF;
  -- Stable order across old/new keys avoids lock-order inversion during edits.
  FOR k IN SELECT DISTINCT unnest(old_keys || new_keys) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('waka.attachment-key:' || k, 0));
  END LOOP;
  FOREACH k IN ARRAY new_keys LOOP PERFORM attachment_object_reference(k); END LOOP;
  FOREACH k IN ARRAY old_keys LOOP
    IF NOT k=ANY(new_keys) THEN PERFORM attachment_object_cleanup(k); END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER attachment_object_copy_change BEFORE INSERT OR UPDATE OF attachments OR DELETE ON deleted_inspirations
  FOR EACH ROW EXECUTE FUNCTION attachment_object_copy_change();
--> statement-breakpoint
CREATE FUNCTION attachment_object_owner_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT key FROM attachment_objects WHERE issued_profile_id=OLD.id AND key IS NOT NULL ORDER BY key LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('waka.attachment-key:' || k,0));
  END LOOP;
  UPDATE attachment_objects SET due_at=now(),generation=generation+1
    WHERE issued_profile_id=OLD.id AND key IS NOT NULL;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER attachment_object_owner_erasure BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION attachment_object_owner_erasure();
