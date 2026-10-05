ALTER TABLE "conversation_reply_requests" ADD COLUMN "retrieval_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_reply_requests" ADD COLUMN "context_sources" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_reply_requests" ADD CONSTRAINT "conversation_context_sources_bounds" CHECK ("context_sources" IS NULL OR (jsonb_typeof("context_sources")='array' AND jsonb_array_length("context_sources")<=21));--> statement-breakpoint
CREATE INDEX "inspiration_embeddings_profile_scope_recent_idx" ON "inspiration_embeddings" ("profile_id","input_scope","model","updated_at" DESC,"id" DESC);
