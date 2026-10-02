ALTER TABLE "principle_signals" ADD COLUMN "statement_revision" bigint;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD COLUMN "statement_revision" bigint;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD COLUMN "material_revision" bigint;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "statement_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD COLUMN "statement_revision" bigint;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_support_revisions_positive" CHECK (("signal_evidence"."statement_revision" IS NULL OR "signal_evidence"."statement_revision" > 0)
      AND ("signal_evidence"."material_revision" IS NULL OR "signal_evidence"."material_revision" > 0));--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_statement_revision_positive" CHECK ("signals"."statement_revision" > 0);
--> statement-breakpoint
CREATE FUNCTION "public"."track_signal_statement_revision"() RETURNS trigger AS $$
BEGIN
  IF NEW.statement IS DISTINCT FROM OLD.statement THEN
    NEW.statement_revision := OLD.statement_revision + 1;
  ELSE NEW.statement_revision := OLD.statement_revision; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER signals_statement_revision BEFORE UPDATE OF statement, statement_revision ON "public"."signals"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_signal_statement_revision"();
--> statement-breakpoint
DROP TRIGGER evidence_generation_revision ON "public"."signal_evidence";
--> statement-breakpoint
CREATE TRIGGER evidence_generation_revision AFTER INSERT OR DELETE OR UPDATE OF
  profile_id, owner_profile_id, signal_id, inspiration_id, material, statement_revision, material_revision
  ON "public"."signal_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."owned_generation_revision"();
