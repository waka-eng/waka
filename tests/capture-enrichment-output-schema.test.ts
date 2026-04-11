import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0014_inspiration_capture_enrichment_outputs/migration.sql",
  "utf8",
).replace(/\s+/g, " ").trim();

test("inspiration model stores dedicated OCR, generated description, and processing state fields for capture enrichment outputs", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*transcript\s+String\?[\s\S]*ocrText\s+String\?\s+@map\("ocr_text"\)[\s\S]*generatedDescription\s+String\?\s+@map\("generated_description"\)[\s\S]*processingState\s+Json\?\s+@map\("processing_state"\)[\s\S]*originalMediaUrl\s+String\?[\s\S]*\}/,
  );
});

test("capture enrichment output migration adds dedicated columns and backfills them from existing OCR metadata and enrichment state", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "ocr_text" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "generated_description" TEXT/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "processing_state" JSONB/,
  );
  assert.match(
    migration,
    /"ocr_text" = COALESCE\([\s\S]*"sourceMeta"->>'ocrText'[\s\S]*"transcript"/,
  );
  assert.match(
    migration,
    /"generated_description" = COALESCE\([\s\S]*"sourceMeta"->>'description'[\s\S]*"transcript"/,
  );
  assert.match(
    migration,
    /"processing_state" = COALESCE\([\s\S]*'generatedDescription'[\s\S]*'ocrText'[\s\S]*"enrichmentStatus"[\s\S]*"enrichmentFields"/,
  );
});
