-- 0074 deleted_inspirations — what a person deleted, kept for thirty days so
-- it can be brought back. See `packages/api/src/db/schema-deleted.ts`.
CREATE TABLE "deleted_inspirations" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "kind" "inspiration_kind",
  "category" text,
  "source" "inspiration_source" NOT NULL,
  "visibility" "inspiration_visibility" NOT NULL,
  "reflections" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "had_photo" boolean NOT NULL DEFAULT false,
  "kept_at" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "deleted_inspirations_recent" ON "deleted_inspirations" ("profile_id","deleted_at");
