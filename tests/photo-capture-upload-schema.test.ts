import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0012_photo_capture_pending_upload_metadata/migration.sql",
  "utf8",
);

test("inspiration model stores dedicated photo upload references and pending-upload metadata", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*mediaUrl\s+String\?[\s\S]*photoStorageKey\s+String\?[\s\S]*photoStorageUrl\s+String\?[\s\S]*photoFileName\s+String\?[\s\S]*photoMimeType\s+String\?[\s\S]*photoSizeBytes\s+Int\?[\s\S]*photoUploadStatus\s+String\?[\s\S]*transcript\s+String\?[\s\S]*\}/,
  );
});

test("photo upload migration adds the pending-upload columns and backfills photo metadata when available", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "photoStorageKey" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "photoStorageUrl" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "photoFileName" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "photoMimeType" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "photoSizeBytes" INTEGER/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "photoUploadStatus" TEXT/,
  );
  assert.match(
    migration,
    /"photoStorageUrl" = COALESCE\("photoStorageUrl", "mediaUrl"\)/,
  );
  assert.match(
    migration,
    /"photoFileName" = COALESCE\([\s\S]*"sourceMeta"->>'fileName'/,
  );
  assert.match(
    migration,
    /"photoMimeType" = COALESCE\([\s\S]*"sourceMeta"->>'mimeType'/,
  );
  assert.match(
    migration,
    /"photoSizeBytes" = COALESCE\([\s\S]*"sourceMeta"->'sizeBytes'/,
  );
  assert.match(
    migration,
    /"photoUploadStatus" = COALESCE\([\s\S]*'UPLOADED'[\s\S]*'PENDING_UPLOAD'/,
  );
  assert.match(
    migration,
    /WHERE "sourceType" = 'PHOTO'/,
  );
});
