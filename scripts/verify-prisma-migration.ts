import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_PATH = path.join("prisma", "schema.prisma");
export const MIGRATIONS_DIR = path.join("prisma", "migrations");
export const MIGRATION_FILE_NAME = "migration.sql";
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
  '"eventType" "DiscoveryEventType" NOT NULL',
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
  'CREATE INDEX "DiscoveryEvent_userId_createdAt_idx" ON "DiscoveryEvent"("userId", "createdAt" DESC);',
  'CREATE INDEX "DiscoveryEvent_userId_eventType_createdAt_idx" ON "DiscoveryEvent"("userId", "eventType", "createdAt" DESC);',
  'CREATE INDEX "DiscoveryEvent_userId_inspirationId_createdAt_idx" ON "DiscoveryEvent"("userId", "inspirationId", "createdAt" DESC);',
  'CREATE INDEX "DiscoveryEvent_userId_previousClusterId_createdAt_idx" ON "DiscoveryEvent"("userId", "previousClusterId", "createdAt" DESC);',
  'CREATE INDEX "DiscoveryEvent_userId_newClusterId_createdAt_idx" ON "DiscoveryEvent"("userId", "newClusterId", "createdAt" DESC);',
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
  'ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_userId_inspirationId_fkey" FOREIGN KEY ("userId", "inspirationId") REFERENCES "Inspiration"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;',
  'ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
];

export function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

export type MigrationFile = {
  name: string;
  path: string;
  sql: string;
};

export type CleanDatabaseCatalog = {
  extensions: Set<string>;
  enums: Set<string>;
  tables: Set<string>;
  columnsByTable: Map<string, Set<string>>;
  indexes: Set<string>;
};

export function createCleanDatabaseCatalog(): CleanDatabaseCatalog {
  return {
    extensions: new Set<string>(),
    enums: new Set<string>(),
    tables: new Set<string>(),
    columnsByTable: new Map<string, Set<string>>(),
    indexes: new Set<string>(),
  };
}

export function readMigrationHistory(dir = MIGRATIONS_DIR) {
  assert.ok(existsSync(dir), `Expected Prisma migrations directory at ${dir}`);

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): MigrationFile => {
      const migrationPath = path.join(dir, entry.name, MIGRATION_FILE_NAME);

      assert.ok(
        existsSync(migrationPath),
        `Expected Prisma migration at ${migrationPath}`,
      );

      return {
        name: entry.name,
        path: migrationPath,
        sql: readFileSync(migrationPath, "utf8"),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1] ?? "";

    current += character;

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (dollarQuoteTag) {
      if (character === "$" && sql.startsWith(dollarQuoteTag, index)) {
        current += sql.slice(index + 1, index + dollarQuoteTag.length);
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      }

      continue;
    }

    if (inSingleQuote) {
      if (character === "'" && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else if (character === "'") {
        inSingleQuote = false;
      }

      continue;
    }

    if (inDoubleQuote) {
      if (character === "\"") {
        inDoubleQuote = false;
      }

      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      current += nextCharacter;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "'") {
      inSingleQuote = true;
      continue;
    }

    if (character === "\"") {
      inDoubleQuote = true;
      continue;
    }

    if (character === "$") {
      const dollarQuoteMatch = sql
        .slice(index)
        .match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);

      if (dollarQuoteMatch) {
        const [tag] = dollarQuoteMatch;
        current += sql.slice(index + 1, index + tag.length);
        index += tag.length - 1;
        dollarQuoteTag = tag;
        continue;
      }
    }

    if (character === ";") {
      const statement = current.trim();

      if (stripSqlLineComments(statement).trim().length > 0) {
        statements.push(statement);
      }

      current = "";
    }
  }

  const trailingStatement = current.trim();

  if (stripSqlLineComments(trailingStatement).trim().length > 0) {
    statements.push(trailingStatement);
  }

  return statements;
}

export function applyMigrationHistoryToCleanDatabase(
  migrations = readMigrationHistory(),
) {
  const catalog = createCleanDatabaseCatalog();

  for (const migration of migrations) {
    for (const statement of splitSqlStatements(migration.sql)) {
      applyMigrationStatement(catalog, statement, migration.name);
    }
  }

  return catalog;
}

export function assertMigrationHistoryAppliesToCleanDatabase() {
  const schema = readSchema();
  const catalog = applyMigrationHistoryToCleanDatabase();

  assert.deepEqual(
    [...catalog.enums].sort(),
    extractSchemaEnums(schema).sort(),
    "Applying the Prisma migration history to a clean catalog should yield every schema enum",
  );

  assert.deepEqual(
    [...catalog.tables].sort(),
    extractSchemaModels(schema).sort(),
    "Applying the Prisma migration history to a clean catalog should yield every schema table",
  );

  assert.ok(
    catalog.tables.has("ApiKey"),
    "Applying the Prisma migration history to a clean catalog should create the ApiKey table",
  );

  return catalog;
}

function applyMigrationStatement(
  catalog: CleanDatabaseCatalog,
  statement: string,
  migrationName: string,
) {
  const trimmedStatement = statement.trim();
  const strippedStatement = stripSqlLineComments(trimmedStatement).trim();
  const normalizedStatement = normalizeSql(strippedStatement);

  if (/^CREATE EXTENSION IF NOT EXISTS vector;?$/i.test(normalizedStatement)) {
    catalog.extensions.add("vector");
    return;
  }

  const createTypeMatch = normalizedStatement.match(
    /^CREATE TYPE "([^"]+)" AS ENUM/i,
  );

  if (createTypeMatch) {
    const [, enumName] = createTypeMatch;

    assert.ok(
      !catalog.enums.has(enumName),
      `Migration ${migrationName} attempts to recreate enum ${enumName}`,
    );

    catalog.enums.add(enumName);
    return;
  }

  const createTableMatch = strippedStatement.match(
    /^CREATE TABLE( IF NOT EXISTS)? "([^"]+)" \(([\s\S]+)\);?$/m,
  );

  if (createTableMatch) {
    const [, ifNotExistsClause, tableName, tableBody] = createTableMatch;

    if (catalog.tables.has(tableName)) {
      assert.ok(
        Boolean(ifNotExistsClause),
        `Migration ${migrationName} attempts to recreate table ${tableName}`,
      );
      return;
    }

    const columns = extractColumnNames(tableBody);
    assertTableDependencies(tableName, tableBody, catalog, migrationName);
    catalog.tables.add(tableName);
    catalog.columnsByTable.set(tableName, columns);
    return;
  }

  const createIndexMatch = normalizedStatement.match(
    /^CREATE(?: UNIQUE)? INDEX( IF NOT EXISTS)? "([^"]+)" ON "([^"]+)"/i,
  );

  if (createIndexMatch) {
    const [, ifNotExistsClause, indexName, tableName] = createIndexMatch;
    registerIndex(
      catalog,
      indexName,
      tableName,
      Boolean(ifNotExistsClause),
      migrationName,
    );
    return;
  }

  const alterTableForeignKeyMatch = normalizedStatement.match(
    /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \([^)]+\) REFERENCES "([^"]+)"/i,
  );

  if (alterTableForeignKeyMatch) {
    const [, tableName, constraintName, referencedTable] =
      alterTableForeignKeyMatch;

    assert.ok(
      catalog.tables.has(tableName),
      `Migration ${migrationName} adds foreign key ${constraintName} before source table ${tableName} exists`,
    );

    assert.ok(
      catalog.tables.has(referencedTable),
      `Migration ${migrationName} adds foreign key ${constraintName} before referenced table ${referencedTable} exists`,
    );

    return;
  }

  const alterTableMatch = normalizedStatement.match(/^ALTER TABLE "([^"]+)"/i);

  if (alterTableMatch) {
    const [, tableName] = alterTableMatch;
    const columns = getTableColumns(catalog, tableName, migrationName);

    let handledAlterTableStatement = false;

    for (const match of normalizedStatement.matchAll(
      /ADD COLUMN(?: IF NOT EXISTS)? "([^"]+)"/g,
    )) {
      columns.add(match[1]);
      handledAlterTableStatement = true;
    }

    for (const match of normalizedStatement.matchAll(
      /ALTER COLUMN "([^"]+)"/g,
    )) {
      assert.ok(
        columns.has(match[1]),
        `Migration ${migrationName} alters missing column ${tableName}.${match[1]}`,
      );
      handledAlterTableStatement = true;
    }

    if (handledAlterTableStatement) {
      return;
    }
  }

  if (normalizedStatement.startsWith("DO $$")) {
    applyDoBlock(catalog, strippedStatement, migrationName);
    return;
  }

  throw new Error(
    `Unsupported Prisma migration statement in ${migrationName}: ${normalizedStatement}`,
  );
}

function assertTableDependencies(
  tableName: string,
  tableBody: string,
  catalog: CleanDatabaseCatalog,
  migrationName: string,
) {
  for (const line of tableBody.split("\n")) {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith("\"")) {
      continue;
    }

    const enumMatch = trimmedLine.match(/^"[^"]+"\s+"([^"]+)"/);

    if (enumMatch) {
      const [, enumName] = enumMatch;
      assert.ok(
        catalog.enums.has(enumName),
        `Migration ${migrationName} creates table ${tableName} before enum ${enumName} exists`,
      );
    }

    if (/\bvector\(\d+\)/i.test(trimmedLine)) {
      assert.ok(
        catalog.extensions.has("vector"),
        `Migration ${migrationName} creates table ${tableName} before the vector extension is enabled`,
      );
    }
  }
}

function applyDoBlock(
  catalog: CleanDatabaseCatalog,
  statement: string,
  migrationName: string,
) {
  for (const tableName of collectTableReferencesFromDoBlock(statement)) {
    assert.ok(
      catalog.tables.has(tableName),
      `Migration ${migrationName} DO block references table ${tableName} before it exists`,
    );
  }

  for (const match of statement.matchAll(
    /ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN IF NOT EXISTS\s+"([^"]+)"/gms,
  )) {
    const [, tableName, columnName] = match;
    const columns = getTableColumns(catalog, tableName, migrationName);
    columns.add(columnName);
  }

  for (const match of statement.matchAll(
    /ALTER TABLE\s+"([^"]+)"\s+ALTER COLUMN\s+"([^"]+)"/gms,
  )) {
    const [, tableName, columnName] = match;
    const columns = getTableColumns(catalog, tableName, migrationName);

    assert.ok(
      columns.has(columnName),
      `Migration ${migrationName} alters missing column ${tableName}.${columnName}`,
    );
  }

  for (const match of statement.matchAll(
    /CREATE(?: UNIQUE)? INDEX IF NOT EXISTS "([^"]+)"\s+ON\s+"([^"]+)"/gms,
  )) {
    const [, indexName, tableName] = match;
    registerIndex(catalog, indexName, tableName, true, migrationName);
  }
}

function collectTableReferencesFromDoBlock(statement: string) {
  const tableReferences = new Set<string>();

  for (const match of statement.matchAll(/to_regclass\('public\."([^"]+)"'\)/g)) {
    tableReferences.add(match[1]);
  }

  for (const match of statement.matchAll(
    /\b(?:FROM|UPDATE|ALTER TABLE)\s+"([^"]+)"/g,
  )) {
    tableReferences.add(match[1]);
  }

  return tableReferences;
}

function extractColumnNames(tableBody: string) {
  const columns = new Set<string>();

  for (const line of tableBody.split("\n")) {
    const match = line.match(/^\s*"([^"]+)"/);

    if (match) {
      columns.add(match[1]);
    }
  }

  return columns;
}

function getTableColumns(
  catalog: CleanDatabaseCatalog,
  tableName: string,
  migrationName: string,
) {
  assert.ok(
    catalog.tables.has(tableName),
    `Migration ${migrationName} references missing table ${tableName}`,
  );

  const columns = catalog.columnsByTable.get(tableName);

  assert.ok(
    columns,
    `Migration ${migrationName} does not have a tracked column set for table ${tableName}`,
  );

  return columns;
}

function registerIndex(
  catalog: CleanDatabaseCatalog,
  indexName: string,
  tableName: string,
  ifNotExists: boolean,
  migrationName: string,
) {
  assert.ok(
    catalog.tables.has(tableName),
    `Migration ${migrationName} creates index ${indexName} before table ${tableName} exists`,
  );

  if (catalog.indexes.has(indexName)) {
    assert.ok(
      ifNotExists,
      `Migration ${migrationName} recreates index ${indexName} without IF NOT EXISTS`,
    );
    return;
  }

  catalog.indexes.add(indexName);
}

function stripSqlLineComments(sql: string) {
  return sql.replace(/^\s*--.*$/gm, "");
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
  assertMigrationHistoryAppliesToCleanDatabase();
  console.log("Prisma migration history verified.");
}
