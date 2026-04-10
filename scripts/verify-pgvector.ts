import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = path.join("prisma", "migrations");
export const MIGRATION_FILE_NAME = "migration.sql";
export const PGVECTOR_EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS vector;";
export const PGVECTOR_SMOKE_TEST_SQL = "SELECT 'test'::vector(3);";

export type PgvectorMigration = {
  path: string;
  sql: string;
};

export function buildPrismaDbExecuteArgs(schemaPath = path.join("prisma", "schema.prisma")) {
  return ["exec", "prisma", "db", "execute", "--schema", schemaPath, "--stdin"];
}

export function findPgvectorMigration(dir = MIGRATIONS_DIR): PgvectorMigration | null {
  if (!existsSync(dir)) {
    return null;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const migrationPath = path.join(dir, entry.name, MIGRATION_FILE_NAME);

    if (!existsSync(migrationPath)) {
      continue;
    }

    const sql = readFileSync(migrationPath, "utf8");

    if (sql.includes(PGVECTOR_EXTENSION_SQL)) {
      return {
        path: migrationPath,
        sql,
      };
    }
  }

  return null;
}

export function assertPgvectorMigrationPresent(dir = MIGRATIONS_DIR): PgvectorMigration {
  const migration = findPgvectorMigration(dir);

  assert.ok(
    migration,
    `Expected a Prisma migration in ${dir} that enables pgvector via "${PGVECTOR_EXTENSION_SQL}"`,
  );

  return migration;
}

export function verifyPgvectorWithDatabase() {
  assertPgvectorMigrationPresent();

  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required to verify pgvector against the database",
  );

  runPrismaDbExecute(PGVECTOR_EXTENSION_SQL);
  runPrismaDbExecute(PGVECTOR_SMOKE_TEST_SQL);
}

function runPrismaDbExecute(sql: string) {
  const result = spawnSync("pnpm", buildPrismaDbExecuteArgs(), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    input: sql,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Prisma db execute failed with exit code ${result.status ?? "unknown"}.`,
        result.stderr?.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  verifyPgvectorWithDatabase();
  console.log("pgvector extension verified.");
}
