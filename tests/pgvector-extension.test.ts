import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PGVECTOR_EXTENSION_SQL,
  PGVECTOR_SMOKE_TEST_SQL,
  assertPgvectorMigrationPresent,
  buildPrismaDbExecuteArgs,
  verifyPgvectorWithDatabase,
} from "../scripts/verify-pgvector.ts";

test("Prisma schema reserves a 1536-dimension vector column for embeddings", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  assert.match(schema, /embedding\s+Unsupported\("vector\(1536\)"\)\?/);
});

test("pgvector migration exists and enables the vector extension before table creation", () => {
  const migration = assertPgvectorMigrationPresent();

  assert.match(migration.path, /prisma[\\/]+migrations[\\/]+0001_enable_pgvector[\\/]+migration\.sql$/);
  assert.match(migration.sql, /CREATE EXTENSION IF NOT EXISTS vector;/);
});

test("pgvector verifier uses the spec smoke test query", () => {
  assert.equal(PGVECTOR_SMOKE_TEST_SQL, "SELECT 'test'::vector(3);");
  assert.deepEqual(buildPrismaDbExecuteArgs(), [
    "exec",
    "prisma",
    "db",
    "execute",
    "--schema",
    "prisma/schema.prisma",
    "--stdin",
  ]);
});

test("database verification fails fast when DATABASE_URL is missing", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  delete process.env.DATABASE_URL;

  assert.throws(
    () => verifyPgvectorWithDatabase(),
    /DATABASE_URL is required to verify pgvector against the database/,
  );

  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
});

test("migration SQL constant matches the applied extension statement", () => {
  assert.equal(PGVECTOR_EXTENSION_SQL, "CREATE EXTENSION IF NOT EXISTS vector;");
});
