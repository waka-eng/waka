/**
 * drizzle-kit configuration.
 *
 * Wires the Drizzle migration tooling (drizzle-kit) to the existing Neon
 * Postgres database referenced by DB_CONNECTION_URL in .env. The schema
 * source-of-truth is the barrel at packages/api/src/db/index.ts which
 * re-exports every table, enum, and relations object across the split
 * schema modules (users + inspirations / attachments / reflections).
 *
 * Usage (from repo root):
 *   pnpm db:generate   # generate SQL migrations from schema diffs
 *   pnpm db:migrate    # apply generated migrations against Neon
 *   pnpm db:push       # push schema directly (dev-only, no migration files)
 *   pnpm db:studio     # open the local Drizzle Studio UI
 *
 * Notes:
 *   - We do NOT provision a new database here. The connection string points
 *     at the pre-existing Neon instance shared with the rest of the stack.
 *   - dotenv is loaded explicitly so the script works regardless of whether
 *     the runner injects .env (drizzle-kit invokes this file via tsx and
 *     does not always load .env from cwd).
 *   - sslmode=require / channel_binding=require are already part of the
 *     connection URL; we don't need to override SSL options here.
 */

import { config as loadDotenv } from "dotenv";

/*
 * `.env.local` WINS, and it has to override rather than defer.
 *
 * drizzle-kit's own bundled dotenv loads `.env` before this file is evaluated,
 * and `.env` in this repo is a byte-identical copy of `.env.example` whose
 * DB_CONNECTION_URL is the placeholder `postgresql://USER:PASSWORD@HOST.neon.tech/DB`.
 * With `override: false` that placeholder was already in process.env and won, so
 * every `db:migrate` / `db:push` / `db:studio` resolved to host HOST.neon.tech and
 * died on DNS — with the error swallowed, leaving only a spinner and exit 1. That
 * silent failure is what taught someone to apply 0002 and 0003 to the shared
 * database BY HAND, which is the whole origin of the ledger drift.
 *
 * `db:generate` and `db:check` never open a connection, so they kept reporting
 * success throughout, which is why the tooling read as half-alive rather than broken.
 */
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env", override: false });

import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DB_CONNECTION_URL;

if (!connectionString) {
  throw new Error(
    "DB_CONNECTION_URL is not set. Add it to .env at the repo root before running drizzle-kit.",
  );
}

export default defineConfig({
  // Single barrel module re-exports every table across the split schema files.
  schema: "./packages/api/src/db/index.ts",
  // Generated SQL migrations live here and are checked into source control.
  out: "./drizzle/migrations",

  dialect: "postgresql",

  dbCredentials: {
    url: connectionString,
  },

  // Verbose / strict make destructive changes (DROP COLUMN, etc.) require
  // explicit confirmation. Safer default while iterating against a shared
  // Neon database.
  verbose: true,
  strict: true,
});
