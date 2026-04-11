import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0009_inspiration_source_parent_lineage/migration.sql",
  "utf8",
);

test("inspiration model stores an originating source parent id for deepened children", () => {
  assert.match(
    schema,
    /model Inspiration \{[\s\S]*parentId\s+String\?[\s\S]*sourceParentId\s+String\?[\s\S]*clusterId\s+String\?/,
  );
  assert.match(
    schema,
    /sourceParent\s+Inspiration\?\s+@relation\("InspirationSourceDepth", fields: \[sourceParentId\], references: \[id\], onDelete: SetNull, onUpdate: Cascade\)/,
  );
});

test("source parent lineage migration backfills rooted lineage and adds the foreign key/index", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "sourceParentId" TEXT/,
  );
  assert.match(
    migration,
    /WITH RECURSIVE inspiration_lineage AS \(/,
  );
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS "Inspiration_userId_sourceParentId_createdAt_idx"/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "Inspiration_sourceParentId_fkey"/,
  );
});
