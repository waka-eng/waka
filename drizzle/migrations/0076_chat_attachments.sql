-- 0076 chat attachments. Founder, 2026-10-15: attachments in chats — photos
-- and files sent with a message, and a message may be photo/file-only.
--
-- AN ATTACHMENT NOW BELONGS TO EXACTLY ONE OWNER: an inspiration (every row
-- before this migration, unchanged) or a chat message. `inspiration_id` loses
-- NOT NULL; its composite FK is MATCH SIMPLE, so a NULL simply opts out of it.
--
-- A CHAT ATTACHMENT HAS TWO STATES, because the upload happens before the
-- message exists (chips sit in the composer; the message id is chosen by the
-- client and the row is created on send):
--   staged  — `conversation_id` + `staged_message_id`: uploaded and finalized
--             for a message that has not been sent yet. No FK can name a row
--             that does not exist, and for a first message the conversation
--             itself does not exist yet either. The route checks ownership
--             instead, and the send links only rows it can match on
--             (profile_id, conversation_id, staged_message_id, id).
--   linked  — `conversation_id` + `message_id`: moved over in the SAME
--             transaction that inserts the message. The composite FK below
--             (profile_id, conversation_id, message_id) makes a cross-profile
--             or cross-conversation link structurally impossible, and its
--             ON DELETE CASCADE removes the row with its message.
-- Chat attachments are uploaded bytes only (image/file with an S3 key): no
-- links, no remote images, no audio.
--
-- THE MESSAGE BOUND IS RELAXED HONESTLY. A user message may now be the empty
-- string '' — exactly '', never whitespace — and assistant messages are still
-- non-empty. "Empty only when it has attachments" cannot be a CHECK: the
-- attachments live in another table, and a CHECK sees one row. The rule is
-- enforced in the message routes (POST /conversations and
-- POST /conversations/:id/messages), which insert the message and link its
-- attachments in one transaction and refuse an empty message with none.
--
-- OBJECT STORAGE: Postgres takes the rows; the conversation DELETE route
-- sweeps the S3 objects of every linked and staged row it removes, and
-- account erasure already walks every row's s3_key. A staged upload whose
-- message is never sent keeps its row (and bytes) until the conversation or
-- account is deleted; no sweeper exists for those yet.
ALTER TABLE "attachments" ALTER COLUMN "inspiration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "staged_message_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_fk" FOREIGN KEY ("profile_id","conversation_id","message_id") REFERENCES "public"."conversation_messages"("profile_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_check" CHECK (
  ("inspiration_id" IS NOT NULL AND "conversation_id" IS NULL AND "message_id" IS NULL AND "staged_message_id" IS NULL)
  OR ("inspiration_id" IS NULL AND "conversation_id" IS NOT NULL AND num_nonnulls("message_id","staged_message_id") = 1
      AND "type" IN ('image','file') AND "s3_key" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("profile_id","conversation_id","message_id") WHERE "message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_staged_idx" ON "attachments" USING btree ("profile_id","staged_message_id") WHERE "staged_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_conversation_idx" ON "attachments" USING btree ("profile_id","conversation_id") WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_bounds";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_bounds" CHECK ("position" BETWEEN 1 AND 200 AND "role" IN ('user','assistant') AND length("content") <= 4000 AND (length(trim("content")) > 0 OR ("role" = 'user' AND "content" = '')));
