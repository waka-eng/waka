ALTER TYPE "public"."background_job_type" ADD VALUE IF NOT EXISTS 'match_introductions';--> statement-breakpoint
CREATE TABLE "introduction_consents" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "introduction_followups" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "introductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_a_id" uuid,
	"profile_b_id" uuid,
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
	"withdrawn_a_at" timestamp with time zone,
	"withdrawn_b_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "introductions_ordered_pair_check" CHECK ("introductions"."profile_a_id" < "introductions"."profile_b_id"),
	CONSTRAINT "introductions_status_check" CHECK ("introductions"."status" IN ('offered', 'accepted', 'declined')),
	CONSTRAINT "introductions_answer_check" CHECK (("introductions"."answer_a" IS NULL OR "introductions"."answer_a" IN ('yes', 'no')) AND ("introductions"."answer_b" IS NULL OR "introductions"."answer_b" IN ('yes', 'no')))
);
--> statement-breakpoint
ALTER TABLE "introduction_consents" ADD CONSTRAINT "introduction_consents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introduction_followups" ADD CONSTRAINT "introduction_followups_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_profile_a_id_profiles_id_fk" FOREIGN KEY ("profile_a_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_profile_b_id_profiles_id_fk" FOREIGN KEY ("profile_b_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_principle_a_fk" FOREIGN KEY ("profile_a_id","principle_a_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_principle_b_fk" FOREIGN KEY ("profile_b_id","principle_b_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "introductions_pair_unique_idx" ON "introductions" USING btree ("profile_a_id","profile_b_id");--> statement-breakpoint
CREATE INDEX "introductions_profile_b_idx" ON "introductions" USING btree ("profile_b_id");--> statement-breakpoint
-- Introductions are between people. An agent or a room's mind can neither
-- consent nor be introduced, whatever route or job tries to write the row.
-- Checked on insert only: a pair's profile ids change only to NULL, when an
-- account is erased.
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
CREATE TRIGGER "introductions_humans_only" BEFORE INSERT ON "introductions"
  FOR EACH ROW EXECUTE FUNCTION "introductions_humans_only"();--> statement-breakpoint
-- ERASING AN ACCOUNT WITHDRAWS ITS SIDE, IT DOES NOT DELETE THE SHARED ROW.
-- Deleting the row would change what the other side sees, and so tell them
-- something. Before the profile goes, its side's words and principle id are
-- erased, an open answer becomes no, and the side is marked withdrawn; the
-- foreign key then sets its profile id to NULL. Nothing that identifies the
-- erased person is left, and the other side's view lapses as usual.
CREATE OR REPLACE FUNCTION "withdraw_profile_from_introductions"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "introductions" SET
    "principle_a_id" = CASE WHEN "profile_a_id" = OLD."id" THEN NULL ELSE "principle_a_id" END,
    "principle_a_text" = CASE WHEN "profile_a_id" = OLD."id" THEN NULL ELSE "principle_a_text" END,
    "withdrawn_a_at" = CASE WHEN "profile_a_id" = OLD."id" THEN coalesce("withdrawn_a_at", now()) ELSE "withdrawn_a_at" END,
    "answer_a" = CASE WHEN "profile_a_id" = OLD."id" AND "status" = 'offered' THEN 'no' ELSE "answer_a" END,
    "principle_b_id" = CASE WHEN "profile_b_id" = OLD."id" THEN NULL ELSE "principle_b_id" END,
    "principle_b_text" = CASE WHEN "profile_b_id" = OLD."id" THEN NULL ELSE "principle_b_text" END,
    "withdrawn_b_at" = CASE WHEN "profile_b_id" = OLD."id" THEN coalesce("withdrawn_b_at", now()) ELSE "withdrawn_b_at" END,
    "answer_b" = CASE WHEN "profile_b_id" = OLD."id" AND "status" = 'offered' THEN 'no' ELSE "answer_b" END,
    "status" = CASE WHEN "status" = 'offered' THEN 'declined' ELSE "status" END,
    "updated_at" = now()
   WHERE "profile_a_id" = OLD."id" OR "profile_b_id" = OLD."id";
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "profiles_withdraw_from_introductions" BEFORE DELETE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION "withdraw_profile_from_introductions"();--> statement-breakpoint
-- A PRINCIPLE LEAVING OR JOINING WHAT A PERSON HOLDS.
--
-- Leaving (rewording it, deleting it, or it ceasing to be held: contested,
-- aspirational, unsupported) withdraws THAT SIDE of every introduction that
-- cites it: its id and words are nulled, so no copy of withdrawn words is
-- kept, and withdrawn_x_at is set. The other side is not touched: their ask
-- stays answerable and a yes just waits, until the ordinary lapse, so a
-- withdrawal looks exactly like silence. The row stays, so the pair is never
-- offered again. Runs BEFORE a delete so the composite foreign key (no
-- action) never sees a dangling citation.
--
-- Joining (a principle becoming held, by any path) is a reason to look again.
--
-- Either way the owner is only MARKED, in introduction_followups, and only
-- while their introductions are on; the application turns marks into
-- ordinary queue jobs (drainIntroductionFollowUps in lib/queue.ts), so the
-- queue keeps one enqueue path. A profile already gone is never marked.
CREATE OR REPLACE FUNCTION "principle_introductions_follow"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  was_held boolean := TG_OP <> 'INSERT' AND OLD."state" = 'held' AND OLD."unsupported_at" IS NULL;
  is_held boolean := TG_OP <> 'DELETE' AND NEW."state" = 'held' AND NEW."unsupported_at" IS NULL;
  owner uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."profile_id" ELSE NEW."profile_id" END;
  withdrawn integer := 0;
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (OLD."statement" IS DISTINCT FROM NEW."statement" OR (was_held AND NOT is_held))) THEN
    UPDATE "introductions" SET
      "principle_a_id" = CASE WHEN "profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id" THEN NULL ELSE "principle_a_id" END,
      "principle_a_text" = CASE WHEN "profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id" THEN NULL ELSE "principle_a_text" END,
      "withdrawn_a_at" = CASE WHEN "profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id" THEN coalesce("withdrawn_a_at", now()) ELSE "withdrawn_a_at" END,
      "principle_b_id" = CASE WHEN "profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id" THEN NULL ELSE "principle_b_id" END,
      "principle_b_text" = CASE WHEN "profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id" THEN NULL ELSE "principle_b_text" END,
      "withdrawn_b_at" = CASE WHEN "profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id" THEN coalesce("withdrawn_b_at", now()) ELSE "withdrawn_b_at" END,
      "updated_at" = now()
     WHERE ("profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id")
        OR ("profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id");
    GET DIAGNOSTICS withdrawn = ROW_COUNT;
  END IF;
  IF (withdrawn > 0 OR (is_held AND NOT was_held))
     AND EXISTS (SELECT 1 FROM "introduction_consents" c WHERE c."profile_id" = owner AND c."enabled")
     AND EXISTS (SELECT 1 FROM "profiles" WHERE "id" = owner) THEN
    INSERT INTO "introduction_followups" ("profile_id") VALUES (owner) ON CONFLICT ("profile_id") DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "principles_introductions_on_delete" BEFORE DELETE ON "principles"
  FOR EACH ROW EXECUTE FUNCTION "principle_introductions_follow"();--> statement-breakpoint
CREATE TRIGGER "principles_introductions_on_change" AFTER INSERT OR UPDATE OF "statement", "state", "unsupported_at" ON "principles"
  FOR EACH ROW EXECUTE FUNCTION "principle_introductions_follow"();
