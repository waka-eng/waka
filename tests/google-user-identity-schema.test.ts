import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/0003_user_google_subject_unique/migration.sql",
  "utf8",
);

test("user model stores the stable Google subject as a unique column", () => {
  assert.match(
    schema,
    /model User \{[\s\S]*googleSubject\s+String\s+@unique\s+@map\("google_subject"\)[\s\S]*\}/,
  );
});

test("google subject migration backfills existing accounts and enforces uniqueness", () => {
  assert.match(
    migration,
    /UPDATE "User" AS u[\s\S]*"provider" = 'google'[\s\S]*u\."google_subject" IS NULL/,
  );
  assert.match(
    migration,
    /ALTER TABLE "User"[\s\S]*ALTER COLUMN "google_subject" SET NOT NULL;/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "User_google_subject_key" ON "User" \("google_subject"\)/,
  );
});
