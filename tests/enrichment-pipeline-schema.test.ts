import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const pipelineTrackingMigration = readFileSync(
  "prisma/migrations/0005_inspiration_enrichment_pipeline_tracking/migration.sql",
  "utf8",
).replace(/\s+/g, " ").trim();
const retryMetadataMigration = readFileSync(
  "prisma/migrations/0006_inspiration_enrichment_retry_metadata/migration.sql",
  "utf8",
).replace(/\s+/g, " ").trim();
const fieldMetadataMigration = readFileSync(
  "prisma/migrations/0008_inspiration_field_enrichment_metadata/migration.sql",
  "utf8",
).replace(/\s+/g, " ").trim();
const resumeStateMigration = readFileSync(
  "prisma/migrations/0010_inspiration_enrichment_resume_state/migration.sql",
  "utf8",
).replace(/\s+/g, " ").trim();

test("inspiration model persists enrichment lifecycle status, retry metadata, last error details, per-field AI progress metadata, and timeout resume state", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*enrichmentStatus\s+String\s+@default\("PENDING"\)[\s\S]*enrichmentEnqueuedAt\s+DateTime\?[\s\S]*enrichmentStartedAt\s+DateTime\?[\s\S]*enrichmentCompletedAt\s+DateTime\?[\s\S]*enrichmentFailedAt\s+DateTime\?[\s\S]*enrichmentAttemptCount\s+Int\s+@default\(0\)[\s\S]*enrichmentMaxAttemptCount\s+Int\s+@default\(3\)[\s\S]*enrichmentLastFailureReason\s+String\?[\s\S]*enrichmentLastFailureRetryability\s+String\?[\s\S]*enrichmentLastError\s+Json\?[\s\S]*enrichmentFields\s+Json\?[\s\S]*enrichmentResumeState\s+Json\?[\s\S]*@@index\(\[userId, enrichmentStatus, enrichmentEnqueuedAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[enrichmentStatus, enrichmentEnqueuedAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );
});

test("follow-up migration adds enrichment pipeline tracking columns and indexes without rewriting existing inspirations", () => {
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT NOT NULL DEFAULT 'PENDING'/,
  );
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentEnqueuedAt" TIMESTAMP\(3\)/,
  );
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentStartedAt" TIMESTAMP\(3\)/,
  );
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentCompletedAt" TIMESTAMP\(3\)/,
  );
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentFailedAt" TIMESTAMP\(3\)/,
  );
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentAttemptCount" INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    pipelineTrackingMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentLastError" JSONB/,
  );
  assert.match(
    pipelineTrackingMigration,
    /CREATE INDEX IF NOT EXISTS "Inspiration_userId_enrichmentStatus_enrichmentEnqueuedAt_idx" ON "Inspiration"\("userId", "enrichmentStatus", "enrichmentEnqueuedAt" DESC\)/,
  );
  assert.match(
    pipelineTrackingMigration,
    /CREATE INDEX IF NOT EXISTS "Inspiration_enrichmentStatus_enrichmentEnqueuedAt_idx" ON "Inspiration"\("enrichmentStatus", "enrichmentEnqueuedAt" DESC\)/,
  );
});

test("follow-up retry metadata migration persists attempt limits and last failure classifiers without rewriting existing inspirations", () => {
  assert.match(
    retryMetadataMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentMaxAttemptCount" INTEGER NOT NULL DEFAULT 3/,
  );
  assert.match(
    retryMetadataMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentLastFailureReason" TEXT/,
  );
  assert.match(
    retryMetadataMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentLastFailureRetryability" TEXT/,
  );
});

test("follow-up field metadata migration persists independent per-field enrichment tracking without rewriting existing inspirations", () => {
  assert.match(
    fieldMetadataMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentFields" JSONB/,
  );
});

test("follow-up resume state migration persists timeout recovery metadata without rewriting existing inspirations", () => {
  assert.match(
    resumeStateMigration,
    /ADD COLUMN IF NOT EXISTS "enrichmentResumeState" JSONB/,
  );
});
