import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  CORE_MIGRATION_PATH,
  REQUIRED_COLUMN_FRAGMENTS,
  REQUIRED_FOREIGN_KEY_FRAGMENTS,
  REQUIRED_INDEX_FRAGMENTS,
  assertMigrationHistoryAppliesToCleanDatabase,
  assertCoreSchemaMigrationMatchesSchema,
  extractCreatedEnums,
  extractCreatedTables,
  extractSchemaEnums,
  extractSchemaModels,
  readMigrationHistory,
  readCoreMigration,
  readSchema,
  splitSqlStatements,
} from "../scripts/verify-prisma-migration.ts";

test("core Prisma migration creates every schema model and enum exactly once", () => {
  const schema = readSchema();
  const migration = readCoreMigration();

  assert.equal(CORE_MIGRATION_PATH, "prisma/migrations/0002_create_core_schema/migration.sql");
  assert.deepEqual(extractCreatedTables(migration).sort(), extractSchemaModels(schema).sort());
  assert.deepEqual(extractCreatedEnums(migration).sort(), extractSchemaEnums(schema).sort());
});

test("core Prisma migration preserves required column shapes for vector and sharing fields", () => {
  const migration = readCoreMigration().replace(/\s+/g, " ").trim();

  for (const fragment of REQUIRED_COLUMN_FRAGMENTS) {
    assert.ok(migration.includes(fragment), `Missing migration column fragment: ${fragment}`);
  }
});

test("core Prisma migration preserves every schema index and uniqueness contract", () => {
  const migration = readCoreMigration().replace(/\s+/g, " ").trim();

  for (const fragment of REQUIRED_INDEX_FRAGMENTS) {
    assert.ok(migration.includes(fragment), `Missing migration index fragment: ${fragment}`);
  }
});

test("core Prisma migration preserves all foreign keys and cascade semantics", () => {
  const migration = readCoreMigration().replace(/\s+/g, " ").trim();

  for (const fragment of REQUIRED_FOREIGN_KEY_FRAGMENTS) {
    assert.ok(migration.includes(fragment), `Missing migration foreign key fragment: ${fragment}`);
  }
});

test("static Prisma migration verifier passes for the committed migration history", () => {
  assert.doesNotThrow(() => assertCoreSchemaMigrationMatchesSchema());
});

test("migration history applies to a clean database catalog and yields every schema table including ApiKey", () => {
  const catalog = assertMigrationHistoryAppliesToCleanDatabase();
  const apiKeyColumns = catalog.columnsByTable.get("ApiKey");
  const clusterColumns = catalog.columnsByTable.get("Cluster");
  const discoveryEventColumns = catalog.columnsByTable.get("DiscoveryEvent");

  assert.ok(catalog.tables.has("ApiKey"));
  assert.ok(catalog.tables.has("DiscoveryEvent"));
  assert.ok(apiKeyColumns?.has("tenantId"));
  assert.ok(apiKeyColumns?.has("workspaceId"));
  assert.ok(apiKeyColumns?.has("description"));
  assert.ok(apiKeyColumns?.has("keyPrefix"));
  assert.ok(apiKeyColumns?.has("metadata"));
  assert.ok(apiKeyColumns?.has("updatedAt"));
  assert.ok(clusterColumns?.has("isPublic"));
  assert.ok(clusterColumns?.has("shareSlug"));
  assert.ok(discoveryEventColumns?.has("userId"));
  assert.ok(discoveryEventColumns?.has("inspirationId"));
  assert.ok(discoveryEventColumns?.has("eventType"));
  assert.ok(discoveryEventColumns?.has("previousClusterId"));
  assert.ok(discoveryEventColumns?.has("newClusterId"));
  assert.deepEqual([...catalog.tables].sort(), extractSchemaModels(readSchema()).sort());
});

test("clean database verifier preserves pgvector-first migration ordering and handles follow-up DO blocks", () => {
  const migrations = readMigrationHistory();

  assert.deepEqual(
    migrations.map((migration) => migration.name),
    [
      "0001_enable_pgvector",
      "0002_create_core_schema",
      "0003_user_google_subject_unique",
      "0004_workspace_scoped_api_keys",
      "0005_inspiration_enrichment_pipeline_tracking",
      "0006_inspiration_enrichment_retry_metadata",
      "0007_inspiration_original_capture_snapshot",
      "0008_inspiration_field_enrichment_metadata",
      "0009_inspiration_source_parent_lineage",
      "0010_inspiration_enrichment_resume_state",
      "0011_voice_note_audio_upload_metadata",
      "0012_photo_capture_pending_upload_metadata",
      "0013_voice_note_transcription_status",
      "0014_inspiration_capture_enrichment_outputs",
      "0015_inspiration_source_conversation_reference",
      "0016_discovery_events",
      "0017_cluster_public_sharing",
    ],
  );

  const statementsByMigration = migrations.map((migration) => ({
    name: migration.name,
    statements: splitSqlStatements(migration.sql),
  }));

  assert.equal(statementsByMigration[0]?.statements[0], "CREATE EXTENSION IF NOT EXISTS vector;");
  assert.equal(statementsByMigration[2]?.statements.length, 2);
  assert.equal(statementsByMigration[3]?.statements.length, 6);
  assert.equal(statementsByMigration[4]?.statements.length, 3);
  assert.equal(statementsByMigration[5]?.statements.length, 1);
  assert.equal(statementsByMigration[6]?.statements.length, 1);
  assert.equal(statementsByMigration[7]?.statements.length, 1);
  assert.equal(statementsByMigration[8]?.statements.length, 3);
  assert.equal(statementsByMigration[9]?.statements.length, 1);
  assert.equal(statementsByMigration[10]?.statements.length, 1);
  assert.equal(statementsByMigration[11]?.statements.length, 1);
  assert.equal(statementsByMigration[12]?.statements.length, 1);
  assert.equal(statementsByMigration[13]?.statements.length, 1);
  assert.equal(statementsByMigration[14]?.statements.length, 1);
  assert.equal(statementsByMigration[15]?.statements.length, 8);
  assert.equal(statementsByMigration[16]?.statements.length, 3);
  assert.match(statementsByMigration[2]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[2]?.statements[1] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[3]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[4]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[5]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[6]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[7]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[8]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[9]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[10]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[11]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[12]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[13]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[14]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[15]?.statements[0] ?? "", /^DO \$\$/);
  assert.match(statementsByMigration[15]?.statements[7] ?? "", /^DO \$\$/);
});

test("follow-up google subject migration is ordered after the core schema migration", () => {
  assert.ok(existsSync("prisma/migrations/0003_user_google_subject_unique/migration.sql"));
  assert.equal(existsSync("prisma/migrations/0002_user_google_subject_unique/migration.sql"), false);
});

test("clean database verifier tracks the immutable original capture snapshot columns", () => {
  const catalog = assertMigrationHistoryAppliesToCleanDatabase();
  const inspirationColumns = catalog.columnsByTable.get("Inspiration");

  assert.ok(inspirationColumns?.has("originalTitle"));
  assert.ok(inspirationColumns?.has("originalRawContent"));
  assert.ok(inspirationColumns?.has("originalSourceUrl"));
  assert.ok(inspirationColumns?.has("originalSourceMeta"));
  assert.ok(inspirationColumns?.has("originalMediaUrl"));
  assert.ok(inspirationColumns?.has("originalTranscript"));
  assert.ok(inspirationColumns?.has("enrichmentFields"));
  assert.ok(inspirationColumns?.has("enrichmentResumeState"));
  assert.ok(inspirationColumns?.has("sourceParentId"));
  assert.ok(inspirationColumns?.has("audioStorageKey"));
  assert.ok(inspirationColumns?.has("audioStorageUrl"));
  assert.ok(inspirationColumns?.has("audioMimeType"));
  assert.ok(inspirationColumns?.has("audioSizeBytes"));
  assert.ok(inspirationColumns?.has("audioDurationSeconds"));
  assert.ok(inspirationColumns?.has("audioTranscriptionStatus"));
  assert.ok(inspirationColumns?.has("photoStorageKey"));
  assert.ok(inspirationColumns?.has("photoStorageUrl"));
  assert.ok(inspirationColumns?.has("photoFileName"));
  assert.ok(inspirationColumns?.has("photoMimeType"));
  assert.ok(inspirationColumns?.has("photoSizeBytes"));
  assert.ok(inspirationColumns?.has("photoUploadStatus"));
  assert.ok(inspirationColumns?.has("ocr_text"));
  assert.ok(inspirationColumns?.has("generated_description"));
  assert.ok(inspirationColumns?.has("processing_state"));
  assert.ok(inspirationColumns?.has("sourceConversationRef"));
  assert.ok(catalog.indexes.has("Inspiration_userId_sourceConversationRef_idx"));
});
