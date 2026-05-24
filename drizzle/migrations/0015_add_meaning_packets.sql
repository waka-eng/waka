CREATE TABLE IF NOT EXISTS "meaning_packets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "inspiration_id" uuid NOT NULL REFERENCES "inspirations"("id") ON DELETE cascade,
  "primary_spark_id" uuid REFERENCES "inspiration_sparks"("id") ON DELETE set null,
  "spark_text" text DEFAULT '' NOT NULL,
  "artifact_excerpt" text DEFAULT '' NOT NULL,
  "packet_text" text NOT NULL,
  "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "classifier_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "input_fingerprint" text NOT NULL,
  "token_estimate" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "meaning_packets_user_inspiration_unique_idx"
  ON "meaning_packets" ("user_id", "inspiration_id");

CREATE INDEX IF NOT EXISTS "meaning_packets_user_updated_idx"
  ON "meaning_packets" ("user_id", "updated_at" DESC);
