CREATE TABLE "inspiration_save_requests" (
  "profile_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "request_hash" text NOT NULL,
  "inspiration_id" uuid,
  "reflection_id" uuid,
  "processing" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inspiration_save_requests_pk" PRIMARY KEY ("profile_id", "request_id"),
  CONSTRAINT "inspiration_save_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE,
  CONSTRAINT "inspiration_save_requests_source_fk" FOREIGN KEY ("profile_id", "inspiration_id") REFERENCES "inspirations"("profile_id", "id"),
  CONSTRAINT "inspiration_save_requests_answer_fk" FOREIGN KEY ("profile_id", "inspiration_id", "reflection_id") REFERENCES "reflections"("profile_id", "inspiration_id", "id"),
  CONSTRAINT "inspiration_save_requests_hash" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "inspiration_save_requests_operation" CHECK ("operation" IN ('inspiration', 'reflection')),
  CONSTRAINT "inspiration_save_requests_result" CHECK (
    ("inspiration_id" IS NULL AND "reflection_id" IS NULL AND "processing" IS NULL) OR
    ("inspiration_id" IS NOT NULL AND "processing" IS NOT NULL AND
      (("operation" = 'inspiration' AND "reflection_id" IS NULL) OR ("operation" = 'reflection' AND "reflection_id" IS NOT NULL)))
  )
);
--> statement-breakpoint
CREATE INDEX "inspiration_save_requests_source_idx" ON "inspiration_save_requests" ("profile_id", "inspiration_id");
--> statement-breakpoint
CREATE INDEX "inspiration_save_requests_answer_idx" ON "inspiration_save_requests" ("profile_id", "reflection_id");
--> statement-breakpoint
-- Preserve only the identity/hash of a removed save. Both FKs retain the
-- tenant; clearing their output references first also keeps cascades safe.
CREATE FUNCTION clear_inspiration_save_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'inspirations' THEN
    UPDATE inspiration_save_requests
      SET inspiration_id = NULL, reflection_id = NULL, processing = NULL
      WHERE profile_id = OLD.profile_id AND inspiration_id = OLD.id;
  ELSE
    UPDATE inspiration_save_requests
      SET inspiration_id = NULL, reflection_id = NULL, processing = NULL
      WHERE profile_id = OLD.profile_id AND inspiration_id = OLD.inspiration_id AND reflection_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clear_inspiration_save_result BEFORE DELETE ON inspirations
  FOR EACH ROW EXECUTE FUNCTION clear_inspiration_save_result();
--> statement-breakpoint
CREATE TRIGGER clear_reflection_save_result BEFORE DELETE ON reflections
  FOR EACH ROW EXECUTE FUNCTION clear_inspiration_save_result();
