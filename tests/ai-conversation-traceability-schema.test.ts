import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0015_inspiration_source_conversation_reference/migration.sql",
  "utf8",
);

test("inspiration model stores an immutable AI conversation reference for long-term summary traceability", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*sourceMeta\s+Json\?[\s\S]*sourceConversationRef\s+String\?[\s\S]*originalSourceUrl\s+String\?[\s\S]*originalSourceMeta\s+Json\?[\s\S]*\}/,
  );
  assert.match(
    schema,
    /@@index\(\[userId, sourceConversationRef\]\)/,
  );
});

test("source conversation reference migration backfills durable AI conversation provenance and adds an index", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "sourceConversationRef" TEXT/,
  );
  assert.match(
    migration,
    /"sourceMeta"->>'conversationId'/,
  );
  assert.match(
    migration,
    /"sourceMeta"->>'threadId'/,
  );
  assert.match(
    migration,
    /"sourceMeta"->>'shareId'/,
  );
  assert.match(
    migration,
    /"sourceMeta"->>'sourceId'/,
  );
  assert.match(
    migration,
    /"sourceMeta"->>'conversationUrl'/,
  );
  assert.match(
    migration,
    /WHERE "sourceType" = 'AI_CONVERSATION'[\s\S]*"sourceConversationRef" IS NULL/,
  );
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS "Inspiration_userId_sourceConversationRef_idx"[\s\S]*\("userId", "sourceConversationRef"\)/,
  );
});
