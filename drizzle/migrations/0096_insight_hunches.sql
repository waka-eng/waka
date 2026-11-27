ALTER TYPE "public"."background_job_type" ADD VALUE IF NOT EXISTS 'generate_hunch';--> statement-breakpoint
CREATE TABLE "hunches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"body" text NOT NULL,
	"inspiration_ids" uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"correction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspirations" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "hunches" ADD CONSTRAINT "hunches_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hunches_profile_created_idx" ON "hunches" USING btree ("profile_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "hunches" ADD CONSTRAINT "hunches_status_check" CHECK ("status" IN ('pending', 'affirmed', 'declined', 'replaced'));--> statement-breakpoint
ALTER TABLE "hunches" ADD CONSTRAINT "hunches_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 400);--> statement-breakpoint
ALTER TABLE "hunches" ADD CONSTRAINT "hunches_correction_length_check" CHECK ("correction" IS NULL OR char_length("correction") BETWEEN 1 AND 600);--> statement-breakpoint
ALTER TABLE "hunches" ADD CONSTRAINT "hunches_cites_check" CHECK (cardinality("inspiration_ids") BETWEEN 1 AND 3);--> statement-breakpoint
ALTER TABLE "inspirations" ADD CONSTRAINT "inspirations_prompt_length_check" CHECK ("prompt" IS NULL OR char_length("prompt") BETWEEN 1 AND 300);--> statement-breakpoint
-- A hunch quotes what it cites: when a cited save is deleted, or its words or
-- its question change, the hunch goes with it rather than outliving its source.
CREATE OR REPLACE FUNCTION "forget_hunches_citing_inspiration"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "hunches" WHERE "profile_id" = OLD."profile_id" AND OLD."id" = ANY("inspiration_ids");
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inspirations_forget_hunches_on_delete" AFTER DELETE ON "inspirations"
  FOR EACH ROW EXECUTE FUNCTION "forget_hunches_citing_inspiration"();--> statement-breakpoint
CREATE TRIGGER "inspirations_forget_hunches_on_edit" AFTER UPDATE OF "text", "prompt" ON "inspirations"
  FOR EACH ROW WHEN (OLD."text" IS DISTINCT FROM NEW."text" OR OLD."prompt" IS DISTINCT FROM NEW."prompt")
  EXECUTE FUNCTION "forget_hunches_citing_inspiration"();
