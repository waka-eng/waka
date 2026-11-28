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
	"principle_a_id" uuid NOT NULL,
	"principle_b_id" uuid NOT NULL,
	"principle_a_text" text NOT NULL,
	"principle_b_text" text NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"answer_a" text,
	"answer_b" text,
	"answered_a_at" timestamp with time zone,
	"answered_b_at" timestamp with time zone,
	"seen_a_at" timestamp with time zone,
	"seen_b_at" timestamp with time zone,
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
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_principle_a_fk" FOREIGN KEY ("profile_a_id","principle_a_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_principle_b_fk" FOREIGN KEY ("profile_b_id","principle_b_id") REFERENCES "public"."principles"("profile_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
-- An introduction rests on the words each person held when it was offered.
-- Rewording a principle withdraws it, as deleting one does (the composite
-- foreign keys cascade), so no copy of withdrawn words outlives them.
CREATE OR REPLACE FUNCTION "forget_introductions_citing_principle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "introductions"
   WHERE ("profile_a_id" = OLD."profile_id" AND "principle_a_id" = OLD."id")
      OR ("profile_b_id" = OLD."profile_id" AND "principle_b_id" = OLD."id");
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "principles_forget_introductions_on_reword" AFTER UPDATE OF "statement" ON "principles"
  FOR EACH ROW WHEN (OLD."statement" IS DISTINCT FROM NEW."statement")
  EXECUTE FUNCTION "forget_introductions_citing_principle"();
