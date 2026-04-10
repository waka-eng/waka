import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_PATH = path.join("prisma", "schema.prisma");
export const CORE_MIGRATION_PATH = path.join(
  "prisma",
  "migrations",
  "0002_create_core_schema",
  "migration.sql",
);

export const REQUIRED_COLUMN_FRAGMENTS = [
  '"google_subject" TEXT NOT NULL',
  '"embedding" vector(1536)',
  '"tags" TEXT[] NOT NULL',
  '"reflectionStatus" "ReflectionStatus" NOT NULL DEFAULT \'PENDING\'',
  '"isPublic" BOOLEAN NOT NULL DEFAULT false',
  '"hashedKey" TEXT NOT NULL',
  '"providerAccountId" TEXT NOT NULL',
  '"sessionToken" TEXT NOT NULL',
];

export const REQUIRED_INDEX_FRAGMENTS = [
  'CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");',
  'CREATE UNIQUE INDEX "User_google_subject_key" ON "User"("google_subject");',
  'CREATE UNIQUE INDEX "User_email_key" ON "User"("email");',
  'CREATE UNIQUE INDEX "Workspace_tenantId_slug_key" ON "Workspace"("tenantId", "slug");',
  'CREATE UNIQUE INDEX "Workspace_tenantId_id_key" ON "Workspace"("tenantId", "id");',
  'CREATE INDEX "Workspace_tenantId_createdAt_idx" ON "Workspace"("tenantId", "createdAt" DESC);',
  'CREATE INDEX "Membership_tenantId_workspaceId_idx" ON "Membership"("tenantId", "workspaceId");',
  'CREATE INDEX "Membership_tenantId_userId_idx" ON "Membership"("tenantId", "userId");',
  'CREATE INDEX "Membership_userId_createdAt_idx" ON "Membership"("userId", "createdAt" DESC);',
  'CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");',
  'CREATE INDEX "Account_userId_idx" ON "Account"("userId");',
  'CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");',
  'CREATE INDEX "Session_userId_idx" ON "Session"("userId");',
  'CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");',
  'CREATE UNIQUE INDEX "Inspiration_userId_id_key" ON "Inspiration"("userId", "id");',
  'CREATE UNIQUE INDEX "Inspiration_userId_sourceType_sourceUrl_key" ON "Inspiration"("userId", "sourceType", "sourceUrl");',
  'CREATE UNIQUE INDEX "Inspiration_userId_sourceType_mediaUrl_key" ON "Inspiration"("userId", "sourceType", "mediaUrl");',
  'CREATE UNIQUE INDEX "Inspiration_shareSlug_key" ON "Inspiration"("shareSlug");',
  'CREATE INDEX "Inspiration_userId_createdAt_idx" ON "Inspiration"("userId", "createdAt" DESC);',
  'CREATE INDEX "Inspiration_userId_deletedAt_idx" ON "Inspiration"("userId", "deletedAt");',
  'CREATE INDEX "Inspiration_userId_deletedAt_createdAt_idx" ON "Inspiration"("userId", "deletedAt", "createdAt" DESC);',
  'CREATE INDEX "Inspiration_userId_sourceType_createdAt_idx" ON "Inspiration"("userId", "sourceType", "createdAt" DESC);',
  'CREATE INDEX "Inspiration_userId_sourceUrl_idx" ON "Inspiration"("userId", "sourceUrl");',
  'CREATE INDEX "Inspiration_userId_mediaUrl_idx" ON "Inspiration"("userId", "mediaUrl");',
  'CREATE INDEX "Inspiration_userId_isPublic_deletedAt_createdAt_idx" ON "Inspiration"("userId", "isPublic", "deletedAt", "createdAt" DESC);',
  'CREATE INDEX "Inspiration_userId_clusterId_createdAt_idx" ON "Inspiration"("userId", "clusterId", "createdAt" DESC);',
  'CREATE INDEX "Inspiration_clusterId_createdAt_idx" ON "Inspiration"("clusterId", "createdAt" DESC);',
  'CREATE INDEX "Inspiration_clusterId_isPublic_deletedAt_createdAt_idx" ON "Inspiration"("clusterId", "isPublic", "deletedAt", "createdAt" DESC);',
  'CREATE UNIQUE INDEX "Cluster_userId_id_key" ON "Cluster"("userId", "id");',
  'CREATE INDEX "Cluster_userId_idx" ON "Cluster"("userId");',
  'CREATE INDEX "Cluster_userId_updatedAt_idx" ON "Cluster"("userId", "updatedAt" DESC);',
  'CREATE UNIQUE INDEX "Connection_sourceId_targetId_key" ON "Connection"("sourceId", "targetId");',
  'CREATE INDEX "Connection_userId_surfacedAt_idx" ON "Connection"("userId", "surfacedAt" DESC);',
  'CREATE INDEX "Connection_userId_dismissed_surfacedAt_idx" ON "Connection"("userId", "dismissed", "surfacedAt" DESC);',
  'CREATE INDEX "Connection_userId_sourceId_surfacedAt_idx" ON "Connection"("userId", "sourceId", "surfacedAt" DESC);',
  'CREATE INDEX "Connection_userId_targetId_surfacedAt_idx" ON "Connection"("userId", "targetId", "surfacedAt" DESC);',
  'CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");',
  'CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");',
  'CREATE INDEX "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId", "createdAt" DESC);',
  'CREATE INDEX "ApiKey_userId_revokedAt_createdAt_idx" ON "ApiKey"("userId", "revokedAt", "createdAt" DESC);',
];

export const REQUIRED_FOREIGN_KEY_FRAGMENTS = [
  'ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_workspaceId_fkey" FOREIGN KEY ("tenantId", "workspaceId") REFERENCES "Workspace"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Inspiration" ADD CONSTRAINT "Inspiration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Inspiration" ADD CONSTRAINT "Inspiration_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Inspiration"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
  'ALTER TABLE "Inspiration" ADD CONSTRAINT "Inspiration_userId_clusterId_fkey" FOREIGN KEY ("userId", "clusterId") REFERENCES "Cluster"("userId", "id") ON DELETE SET NULL ON UPDATE CASCADE;',
  'ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Connection" ADD CONSTRAINT "Connection_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Inspiration"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "Connection" ADD CONSTRAINT "Connection_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Inspiration"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
];

export function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

export function readSchema() {
  return readFileSync(SCHEMA_PATH, "utf8");
}

export function readCoreMigration() {
  assert.ok(
    existsSync(CORE_MIGRATION_PATH),
    `Expected Prisma migration at ${CORE_MIGRATION_PATH}`,
  );

  return readFileSync(CORE_MIGRATION_PATH, "utf8");
}

export function extractSchemaModels(schema = readSchema()) {
  return [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]);
}

export function extractSchemaEnums(schema = readSchema()) {
  return [...schema.matchAll(/^enum\s+(\w+)\s+\{/gm)].map((match) => match[1]);
}

export function extractCreatedTables(sql = readCoreMigration()) {
  return [...sql.matchAll(/^CREATE TABLE "(\w+)"/gm)].map((match) => match[1]);
}

export function extractCreatedEnums(sql = readCoreMigration()) {
  return [...sql.matchAll(/^CREATE TYPE "(\w+)"/gm)].map((match) => match[1]);
}

export function assertCoreSchemaMigrationMatchesSchema() {
  const schema = readSchema();
  const migration = readCoreMigration();
  const normalizedMigration = normalizeSql(migration);

  assert.deepEqual(
    extractCreatedEnums(migration).sort(),
    extractSchemaEnums(schema).sort(),
    "Migration enums should exactly match prisma/schema.prisma",
  );

  assert.deepEqual(
    extractCreatedTables(migration).sort(),
    extractSchemaModels(schema).sort(),
    "Migration tables should exactly match prisma/schema.prisma models",
  );

  for (const fragment of REQUIRED_COLUMN_FRAGMENTS) {
    assert.ok(
      normalizedMigration.includes(fragment),
      `Expected migration to include SQL fragment: ${fragment}`,
    );
  }

  for (const fragment of REQUIRED_INDEX_FRAGMENTS) {
    assert.ok(
      normalizedMigration.includes(fragment),
      `Expected migration to include SQL fragment: ${fragment}`,
    );
  }

  for (const fragment of REQUIRED_FOREIGN_KEY_FRAGMENTS) {
    assert.ok(
      normalizedMigration.includes(fragment),
      `Expected migration to include SQL fragment: ${fragment}`,
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  assertCoreSchemaMigrationMatchesSchema();
  console.log("Prisma core schema migration verified.");
}
