import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  CORE_MIGRATION_PATH,
  REQUIRED_COLUMN_FRAGMENTS,
  REQUIRED_FOREIGN_KEY_FRAGMENTS,
  REQUIRED_INDEX_FRAGMENTS,
  assertCoreSchemaMigrationMatchesSchema,
  extractCreatedEnums,
  extractCreatedTables,
  extractSchemaEnums,
  extractSchemaModels,
  readCoreMigration,
  readSchema,
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

test("follow-up google subject migration is ordered after the core schema migration", () => {
  assert.ok(existsSync("prisma/migrations/0003_user_google_subject_unique/migration.sql"));
  assert.equal(existsSync("prisma/migrations/0002_user_google_subject_unique/migration.sql"), false);
});
