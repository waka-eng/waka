import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0004_workspace_scoped_api_keys/migration.sql",
  "utf8",
).replace(/\s+/g, " ").trim();

test("workspace model exposes API keys for workspace-scoped ownership", () => {
  assert.match(
    schema,
    /model Workspace \{[\s\S]*apiKeys\s+ApiKey\[\][\s\S]*\}/,
  );
});

test("api key model stores workspace scope, metadata, and hashed-only secret material", () => {
  assert.match(
    schema,
    /model ApiKey \{[\s\S]*userId\s+String[\s\S]*tenantId\s+String[\s\S]*workspaceId\s+String[\s\S]*name\s+String[\s\S]*description\s+String\?[\s\S]*keyPrefix\s+String[\s\S]*metadata\s+Json\?[\s\S]*hashedKey\s+String\s+@unique[\s\S]*updatedAt\s+DateTime\s+@updatedAt[\s\S]*workspace\s+Workspace\s+@relation\(fields: \[tenantId, workspaceId\], references: \[tenantId, id\], onDelete: Cascade, onUpdate: Cascade\)[\s\S]*@@index\(\[tenantId, workspaceId\]\)[\s\S]*@@index\(\[userId, workspaceId, revokedAt, createdAt\(sort: Desc\)\]\)[\s\S]*@@index\(\[userId, workspaceId, lastUsedAt\(sort: Desc\)\]\)[\s\S]*\}/,
  );

  assert.doesNotMatch(
    schema,
    /model ApiKey \{[\s\S]*(plainKey|plaintextKey|rawKey)\s+String[\s\S]*\}/,
  );
});

test("workspace-scoped api key migration adds the new columns, indexes, and foreign key", () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "tenantId" TEXT NOT NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "workspaceId" TEXT NOT NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT NOT NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "metadata" JSONB/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP\(3\) NOT NULL/,
  );
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS "ApiKey_tenantId_workspaceId_idx" ON "ApiKey"\("tenantId", "workspaceId"\)/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "ApiKey_tenantId_workspaceId_fkey" FOREIGN KEY \("tenantId", "workspaceId"\) REFERENCES "Workspace"\("tenantId", "id"\)/,
  );
});
