import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0011_voice_note_audio_upload_metadata/migration.sql",
  "utf8",
);
const transcriptionStatusMigration = readFileSync(
  "prisma/migrations/0013_voice_note_transcription_status/migration.sql",
  "utf8",
);

test("inspiration model stores uploaded voice-note references and upload metadata", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*mediaUrl\s+String\?[\s\S]*audioStorageKey\s+String\?[\s\S]*audioStorageUrl\s+String\?[\s\S]*audioMimeType\s+String\?[\s\S]*audioSizeBytes\s+Int\?[\s\S]*audioDurationSeconds\s+Float\?[\s\S]*audioTranscriptionStatus\s+String\?[\s\S]*transcript\s+String\?[\s\S]*\}/,
  );
});

test("voice-note upload migration adds the audio reference columns and backfills voice metadata when available", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "audioStorageKey" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "audioStorageUrl" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "audioMimeType" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "audioSizeBytes" INTEGER/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "audioDurationSeconds" DOUBLE PRECISION/,
  );
  assert.match(
    migration,
    /"audioStorageUrl" = COALESCE\("audioStorageUrl", "mediaUrl"\)/,
  );
  assert.match(
    migration,
    /"audioMimeType" = COALESCE\([\s\S]*"sourceMeta"->>'mimeType'/,
  );
  assert.match(
    migration,
    /"audioSizeBytes" = COALESCE\([\s\S]*"sourceMeta"->'sizeBytes'/,
  );
  assert.match(
    migration,
    /"audioDurationSeconds" = COALESCE\([\s\S]*"sourceMeta"->'durationSeconds'/,
  );
  assert.match(
    migration,
    /WHERE "sourceType" = 'VOICE_NOTE'/,
  );
});

test("voice-note transcription status migration adds a persisted transcription lifecycle and backfills transcript text", () => {
  assert.match(
    transcriptionStatusMigration,
    /ADD COLUMN IF NOT EXISTS "audioTranscriptionStatus" TEXT/,
  );
  assert.match(
    transcriptionStatusMigration,
    /"transcript" = COALESCE\([\s\S]*"rawContent"[\s\S]*\)/,
  );
  assert.match(
    transcriptionStatusMigration,
    /"originalTranscript" = COALESCE\([\s\S]*"rawContent"[\s\S]*\)/,
  );
  assert.match(
    transcriptionStatusMigration,
    /"audioTranscriptionStatus" = COALESCE\([\s\S]*THEN 'COMPLETED'[\s\S]*THEN 'PENDING'/,
  );
  assert.match(
    transcriptionStatusMigration,
    /WHERE "sourceType" = 'VOICE_NOTE'/,
  );
});
