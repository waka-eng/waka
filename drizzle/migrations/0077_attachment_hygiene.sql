-- 0077 attachment hygiene (code review of 0076, 2026-10-16).
--
-- ONE STORED OBJECT, ONE ATTACHMENT is checked by every door that writes an
-- uploaded key (note capture, the inspiration finalize, the chat finalize):
-- each looks the key up before inserting, and the sweeps look keys up before
-- deleting bytes. Before this index those lookups scanned the table, the
-- chat finalize's under its profile lock.
--
-- NOT UNIQUE, deliberately. Until 2026-10-16 the inspiration finalize
-- (POST /api/attachments with an inspirationId) and note capture never
-- checked for reuse, so a retried finalize could write a second row naming
-- the same key; production may hold such legacy duplicates, and a UNIQUE
-- index would fail this migration there. The application checks are the
-- rule; this index serves them.
CREATE INDEX IF NOT EXISTS "attachments_s3_key_idx" ON "attachments" USING btree ("s3_key") WHERE "s3_key" IS NOT NULL;--> statement-breakpoint
-- The worker's daily sweep of staged chat uploads whose message was never
-- sent (older than seven days), oldest first.
CREATE INDEX IF NOT EXISTS "attachments_staged_age_idx" ON "attachments" USING btree ("created_at") WHERE "staged_message_id" IS NOT NULL;
