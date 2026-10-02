ALTER TABLE "principle_signals" ADD COLUMN "principle_statement_revision" bigint;--> statement-breakpoint
ALTER TABLE "principles" ADD COLUMN "statement_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "top_of_mind_entries" ADD COLUMN "body_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "top_of_mind_entry_signals" ADD COLUMN "entry_body_revision" bigint;
--> statement-breakpoint
CREATE FUNCTION "public"."track_principle_statement_revision"() RETURNS trigger AS $$
BEGIN
  IF NEW.statement IS DISTINCT FROM OLD.statement THEN NEW.statement_revision := OLD.statement_revision + 1;
  ELSE NEW.statement_revision := OLD.statement_revision; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER principles_statement_revision BEFORE UPDATE OF statement, statement_revision ON "public"."principles"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_principle_statement_revision"();
--> statement-breakpoint
CREATE FUNCTION "public"."track_entry_body_revision"() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.body, NEW.type::text) IS DISTINCT FROM ROW(OLD.body, OLD.type::text) THEN NEW.body_revision := OLD.body_revision + 1;
  ELSE NEW.body_revision := OLD.body_revision; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entries_body_revision BEFORE UPDATE OF body, type, body_revision ON "public"."top_of_mind_entries"
  FOR EACH ROW EXECUTE FUNCTION "public"."track_entry_body_revision"();
