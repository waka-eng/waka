-- Personal vectors may contain private answers. Never reuse them in rooms.
-- Deployment requires draining/stopping old derivation workers before this
-- index replacement: their two-column ON CONFLICT target is no longer valid.
ALTER TABLE "public"."inspiration_embeddings"
  ADD COLUMN "input_scope" text NOT NULL DEFAULT 'personal';
--> statement-breakpoint
ALTER TABLE "public"."inspiration_embeddings"
  ADD CONSTRAINT "inspiration_embeddings_input_scope_check"
  CHECK ("input_scope" IN ('personal', 'public'));
--> statement-breakpoint
DROP INDEX "public"."inspiration_embeddings_inspiration_model_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "inspiration_embeddings_inspiration_model_scope_idx"
  ON "public"."inspiration_embeddings" ("inspiration_id", "model", "input_scope");
--> statement-breakpoint
-- Null is intentional: this migration cannot certify existing room output.
ALTER TABLE "public"."signals" ADD COLUMN "input_policy" text;
