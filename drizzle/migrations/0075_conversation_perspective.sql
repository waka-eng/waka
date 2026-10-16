-- 0075 conversations.perspective — whose memory a chat answers from: the
-- person's own ('mine', every existing chat), their agent's ('agent'), or
-- both side by side ('both'). The chat itself stays the person's; only the
-- memory it reads changes. See `packages/api/src/db/schema-conversations.ts`.
ALTER TABLE "conversations" ADD COLUMN "perspective" text NOT NULL DEFAULT 'mine';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agent_profile_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_perspective_check" CHECK ("perspective" IN ('mine','agent','both'));
