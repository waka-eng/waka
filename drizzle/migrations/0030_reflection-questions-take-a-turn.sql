-- A question based on a saved reflection spends the model key, so it has a
-- metered background job of its own. The generated question is kept in that
-- job's payload until the person answers; only their answer is memory.
ALTER TYPE "public"."background_job_type" ADD VALUE IF NOT EXISTS 'generate_reflection_question';
