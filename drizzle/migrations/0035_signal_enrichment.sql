-- What the heart actually reacted to, when the save is a bare link.
--
-- Many signals are URLs. The pipeline synthesizes from text embeddings, so a
-- naked link is nearly mute to it: the reaction was to something inside the
-- page, and only the wrapper was stored. Measured on the two real groups,
-- 61% of shared signals carried >=120 chars of audible text; one member sat
-- at 1/14 and was unreadable for exactly this reason.
--
-- `enriched_at` marks the ATTEMPT, not success — a fetch that failed should
-- not be retried on every pass, and null enrichment with a timestamp says
-- "we tried, the page would not speak".
ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "enrichment" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "enriched_at" timestamp with time zone;
