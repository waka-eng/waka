CREATE INDEX IF NOT EXISTS "inspiration_embeddings_user_model_dimensions_idx" ON "inspiration_embeddings" USING btree ("user_id","model","dimensions");
