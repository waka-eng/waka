CREATE TABLE IF NOT EXISTS "inspiration_sparks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "inspiration_id" uuid NOT NULL REFERENCES "inspirations"("id") ON DELETE cascade,
  "text" text NOT NULL,
  "source" text DEFAULT 'user_selected' NOT NULL,
  "start_offset" integer,
  "end_offset" integer,
  "confidence" integer DEFAULT 100 NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "note" text,
  "what_moved_user" text,
  "implied_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "worldview_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decision_relevance" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "emotional_charge" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "inspiration_sparks_user_inspiration_idx"
  ON "inspiration_sparks" ("user_id", "inspiration_id");

CREATE INDEX IF NOT EXISTS "inspiration_sparks_inspiration_created_idx"
  ON "inspiration_sparks" ("inspiration_id", "created_at" DESC);
