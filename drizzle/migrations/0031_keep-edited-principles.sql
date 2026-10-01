-- Keep lost evidence distinct from a person's wording and disagreement.
ALTER TABLE "public"."principles" ADD COLUMN IF NOT EXISTS "unsupported_at" timestamp with time zone;
