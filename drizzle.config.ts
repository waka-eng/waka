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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

/*
 * WHICH DATABASE THIS TOOL TALKS TO, AND WHY IT TAKES THIS MUCH CODE.
 *
 * Three sources want to answer, and each has been wrong at least once:
 *
 *   1. The SHELL. `DB_CONNECTION_URL=postgres://localhost/scratch pnpm db:migrate`
 *      must migrate the scratch database. This is how anyone rehearses a
 *      migration safely, and it MUST win.
 *   2. `.env.local` — the real dev credentials on a developer's machine.
 *   3. `.env` — in this repo a byte-identical copy of `.env.example`, whose
 *      DB_CONNECTION_URL is the placeholder
 *      `postgresql://USER:PASSWORD@HOST.neon.tech/DB`. It must never win.
 *
 * The difficulty is that drizzle-kit's own bundled dotenv loads `.env` BEFORE
 * this file is evaluated, so by the time we look, `process.env` may already
 * hold that placeholder and there is nothing to distinguish it from a value
 * the user set deliberately.
 *
 * Both naive answers have now failed in production:
 *
 *   `override: false` let the placeholder win, so every db:migrate resolved to
 *   HOST.neon.tech and died on DNS with the error swallowed — a spinner, then
 *   exit 1, no message. That silent failure is what taught someone to apply
 *   migrations to the shared database BY HAND, and is the origin of the whole
 *   ledger drift this branch had to repair.
 *
 *   `override: true` fixed that and broke the other end: a DB_CONNECTION_URL
 *   set in the shell was silently DISCARDED, so `pnpm db:migrate` pointed at a
 *   throwaway database migrated the live dev one instead. It reports success
 *   either way, so there is no signal. It happened: a rehearsal wrote nine rows
 *   to the live dev ledger.
 *
 * So resolve it by comparing against `.env`'s own value rather than guessing.
 * If what is in the environment is exactly what `.env` says, nobody chose it —
 * it is the placeholder arriving by accident, and `.env.local` may override it.
 * If it differs, a human or a CI job set it on purpose, and it wins outright.
 */
const envFileValue = ((): string | undefined => {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    return /^DB_CONNECTION_URL=(.*)$/m.exec(raw)?.[1]?.trim();
  } catch {
    return undefined;
  }
})();

const beforeDotenv = process.env.DB_CONNECTION_URL;
const chosenDeliberately =
  beforeDotenv !== undefined && beforeDotenv !== "" && beforeDotenv !== envFileValue;

loadDotenv({ path: ".env.local", override: !chosenDeliberately });
loadDotenv({ path: ".env", override: false });

if (chosenDeliberately) process.env.DB_CONNECTION_URL = beforeDotenv;

/* A placeholder is not a database. Fail loudly rather than resolving DNS for
   `HOST.neon.tech` and reporting a swallowed error. */
if (/HOST\.neon\.tech|USER:PASSWORD/.test(process.env.DB_CONNECTION_URL ?? "")) {
  throw new Error(
    "DB_CONNECTION_URL is the .env.example placeholder. Set a real one in " +
      ".env.local, or pass DB_CONNECTION_URL=... on the command line.",
  );
}

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
