ALTER TYPE "public"."background_job_type" ADD VALUE IF NOT EXISTS 'match_introductions';--> statement-breakpoint
CREATE TABLE "introduction_consents" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "introductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_a_id" uuid NOT NULL,
	"profile_b_id" uuid NOT NULL,
	"principle_a_id" uuid,
	"principle_b_id" uuid,
	"principle_a_text" text,
	"principle_b_text" text,
	"status" text DEFAULT 'offered' NOT NULL,
	"answer_a" text,
	"answer_b" text,
	"answered_a_at" timestamp with time zone,
	"answered_b_at" timestamp with time zone,
	"seen_a_at" timestamp with time zone,
	"seen_b_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "introductions_ordered_pair_check" CHECK ("introductions"."profile_a_id" < "introductions"."profile_b_id"),
	CONSTRAINT "introductions_status_check" CHECK ("introductions"."status" IN ('offered', 'accepted', 'declined')),
	CONSTRAINT "introductions_answer_check" CHECK (("introductions"."answer_a" IS NULL OR "introductions"."answer_a" IN ('yes', 'no')) AND ("introductions"."answer_b" IS NULL OR "introductions"."answer_b" IN ('yes', 'no')))
);
--> statement-breakpoint
ALTER TABLE "introduction_consents" ADD CONSTRAINT "introduction_consents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_profile_a_id_profiles_id_fk" FOREIGN KEY ("profile_a_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_profile_b_id_profiles_id_fk" FOREIGN KEY ("profile_b_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_principle_a_fk" FOREIGN KEY ("profile_a_id","principle_a_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_principle_b_fk" FOREIGN KEY ("profile_b_id","principle_b_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "introductions_pair_unique_idx" ON "introductions" USING btree ("profile_a_id","profile_b_id");--> statement-breakpoint
CREATE INDEX "introductions_profile_b_idx" ON "introductions" USING btree ("profile_b_id");--> statement-breakpoint
-- Introductions are between people. An agent or a room's mind can neither
-- consent nor be introduced, whatever route or job tries to write the row.
CREATE OR REPLACE FUNCTION "introductions_humans_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'introduction_consents' THEN
    IF NOT EXISTS (SELECT 1 FROM "profiles" WHERE "id" = NEW."profile_id" AND "type" = 'human') THEN
      RAISE EXCEPTION 'introductions are for human profiles only' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (SELECT count(*) FROM "profiles" WHERE "id" IN (NEW."profile_a_id", NEW."profile_b_id") AND "type" = 'human') <> 2 THEN
    RAISE EXCEPTION 'introductions are for human profiles only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "introduction_consents_humans_only" BEFORE INSERT OR UPDATE OF "profile_id" ON "introduction_consents"
  FOR EACH ROW EXECUTE FUNCTION "introductions_humans_only"();--> statement-breakpoint
CREATE TRIGGER "introductions_humans_only" BEFORE INSERT OR UPDATE OF "profile_a_id", "profile_b_id" ON "introductions"
  FOR EACH ROW EXECUTE FUNCTION "introductions_humans_only"();--> statement-breakpoint
-- WITHDRAWING A PRINCIPLE (rewording it, deleting it, or it ceasing to be
-- held: contested, aspirational again, or unsupported) withdraws it from every
-- introduction that cites it: that side's id and words are nulled, so no copy
-- of withdrawn words is kept, and the row is closed for both. The row stays,
-- so the pair is never offered again. Runs BEFORE a delete so the composite
-- foreign key (no action) never sees a dangling citation.
--
-- Both people are free again, so each gets a match pass, written straight to
-- the queue in the same transaction. Such a row only exists where matching
-- ran (WAKA_INTRODUCTIONS=1), and the job reads the flag again before it
-- does anything. A profile already gone (an account being erased) gets none.
CREATE OR REPLACE FUNCTION "withdraw_principle_from_introductions"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  freed uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."statement" IS NOT DISTINCT FROM NEW."statement"
     AND NOT (OLD."state" = 'held' AND OLD."unsupported_at" IS NULL
              AND (NEW."state" <> 'held' OR NEW."unsupported_at" IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  FOR freed IN
    WITH closed AS (
      UPDATE "introductions" SET
        "principle_a_id" = CASE WHEN "profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id" THEN NULL ELSE "principle_a_id" END,
        "principle_a_text" = CASE WHEN "profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id" THEN NULL ELSE "principle_a_text" END,
        "principle_b_id" = CASE WHEN "profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id" THEN NULL ELSE "principle_b_id" END,
        "principle_b_text" = CASE WHEN "profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id" THEN NULL ELSE "principle_b_text" END,
        "closed_at" = coalesce("closed_at", now()),
        "updated_at" = now()
       WHERE ("profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id")
          OR ("profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id")
      RETURNING "profile_a_id", "profile_b_id"
    )
    SELECT DISTINCT x FROM closed, LATERAL (VALUES ("profile_a_id"), ("profile_b_id")) AS v(x)
  LOOP
    INSERT INTO "background_jobs" ("profile_id", "type", "payload", "max_attempts", "idempotency_key")
    SELECT freed, 'match_introductions', '{"reason":"withdrawn"}'::jsonb, 3, 'match_introductions:' || freed || ':withdrawn'
     WHERE EXISTS (SELECT 1 FROM "profiles" WHERE "id" = freed)
    ON CONFLICT ("idempotency_key") WHERE "idempotency_key" IS NOT NULL DO UPDATE SET
      "status" = CASE WHEN "background_jobs"."status" IN ('succeeded', 'failed') THEN 'pending'::background_job_status ELSE "background_jobs"."status" END,
      "attempts" = CASE WHEN "background_jobs"."status" IN ('succeeded', 'failed') THEN 0 ELSE "background_jobs"."attempts" END,
      "run_after" = CASE WHEN "background_jobs"."status" IN ('succeeded', 'failed') THEN now() ELSE "background_jobs"."run_after" END,
      "locked_at" = CASE WHEN "background_jobs"."status" IN ('succeeded', 'failed') THEN NULL ELSE "background_jobs"."locked_at" END,
      "last_error" = CASE WHEN "background_jobs"."status" IN ('succeeded', 'failed') THEN NULL ELSE "background_jobs"."last_error" END,
      "rerun_requested" = ("background_jobs"."status" = 'running'),
      "request_version" = "background_jobs"."request_version" + 1,
      "updated_at" = now();
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "principles_withdraw_from_introductions_on_delete" BEFORE DELETE ON "principles"
  FOR EACH ROW EXECUTE FUNCTION "withdraw_principle_from_introductions"();--> statement-breakpoint
CREATE TRIGGER "principles_withdraw_from_introductions_on_change" AFTER UPDATE OF "statement", "state", "unsupported_at" ON "principles"
  FOR EACH ROW EXECUTE FUNCTION "withdraw_principle_from_introductions"();
