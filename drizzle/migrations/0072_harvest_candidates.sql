-- 0072 harvest_candidates — sentences of the person's own, picked from their
-- work by a collector they run, waiting to be kept or let go. See
-- `packages/api/src/db/schema-harvest.ts` for why the words live here only
-- while a candidate is undecided.
CREATE TABLE "harvest_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "text" text,
  "title" text,
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_hash" text,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "inspiration_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "decided_at" timestamp with time zone,
  CONSTRAINT "harvest_candidates_status_check" CHECK ("status" IN ('pending','kept','declined','lapsed')),
  CONSTRAINT "harvest_candidates_reason_check" CHECK ("reason" IS NULL OR "reason" IN ('not_mine','already_kept','private','trivial','miscut')),
  CONSTRAINT "harvest_candidates_words_check" CHECK (("status" = 'pending') = ("text" IS NOT NULL)),
  CONSTRAINT "harvest_candidates_inspiration_fk" FOREIGN KEY ("profile_id","inspiration_id") REFERENCES "inspirations"("profile_id","id") ON DELETE SET NULL ("inspiration_id")
);--> statement-breakpoint
CREATE INDEX "harvest_candidates_waiting" ON "harvest_candidates" ("profile_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harvest_candidates_once" ON "harvest_candidates" ("profile_id","source_hash");
