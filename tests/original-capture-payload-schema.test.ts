import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0007_inspiration_original_capture_snapshot/migration.sql",
  "utf8",
);

test("inspiration model stores an immutable snapshot of the original capture payload", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*title\s+String\?[\s\S]*rawContent\s+String[\s\S]*summary\s+String\?[\s\S]*originalTitle\s+String\?[\s\S]*originalRawContent\s+String[\s\S]*sourceType\s+SourceType[\s\S]*sourceUrl\s+String\?[\s\S]*sourceMeta\s+Json\?[\s\S]*originalSourceUrl\s+String\?[\s\S]*originalSourceMeta\s+Json\?[\s\S]*mediaUrl\s+String\?[\s\S]*transcript\s+String\?[\s\S]*originalMediaUrl\s+String\?[\s\S]*originalTranscript\s+String\?[\s\S]*\}/,
  );
});

test("original capture snapshot migration backfills existing inspirations and enforces raw content durability", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "originalTitle" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "originalRawContent" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "originalSourceUrl" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "originalSourceMeta" JSONB/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "originalMediaUrl" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "originalTranscript" TEXT/,
  );
  assert.match(
    migration,
    /UPDATE "Inspiration"[\s\S]*"originalRawContent" = COALESCE\("originalRawContent", "rawContent"\)/,
  );
  assert.match(
    migration,
    /ALTER TABLE "Inspiration"[\s\S]*ALTER COLUMN "originalRawContent" SET NOT NULL;/,
  );
});
