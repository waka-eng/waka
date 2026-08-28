/**
 * THE FILE A DEVELOPER PUTS THEIR DATABASE URL IN IS THE FILE THE TOOLS READ.
 *
 * WHAT THIS CAUGHT, on 2026-08-28, walking the README's own quickstart on a
 * fresh checkout. Three documents named three different files, and the tools
 * split along the same seam:
 *
 *   README, "Environment"        — "Development reads `.env.local`."
 *   AGENTS.md, "Things that…"    — "Local work uses `.env.local`."
 *   `.env.example`, line 4       — "Copy to `.env` at the repo root."
 *   `scripts/dev-local.sh`       — reads `.env.local`, and nothing else.
 *   `tools/seed-demo.ts`         — read `.env`, then `.env.development`.
 *
 * So no single file satisfied the README's own quickstart. Put the URL where
 * the README says and `pnpm demo:seed` — printed four lines further down that
 * same page — could not find a database. Put it where `.env.example` says and
 * `pnpm dev:local` warns and starts anyway, with no database configured, and
 * fails later somewhere that does not mention env files at all.
 *
 * WHY IT WAS INVISIBLE. Neither tool said "no database". `dev:local` warns
 * about a missing file and continues, because CI legitimately boots it with
 * the variables exported inline. `seed-demo` found no URL, so its argument
 * parser fell through to `usage()` — a new developer read that as "I typed
 * the command wrong" and retyped it, which is the failure this whole suite
 * exists to make impossible to have twice.
 *
 * WHY A TEST AND NOT A COMMENT. Every part of this is a claim about a file
 * that some other file's prose depends on, and prose cannot fail CI. The doc
 * assertions below are deliberately about the DOCUMENTS, not only the code:
 * the bug was never that a loader was wrong on its own, it was that the
 * loaders and the instructions disagreed, and a fix to only one side of a
 * disagreement is not a fix.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), "utf8");

describe("the local env file is the same file everywhere", () => {
  it("has dev:local reading .env.local", () => {
    expect(read("scripts/dev-local.sh")).toMatch(/env_file="\$repo_root\/\.env\.local"/);
  });

  it("has the seeder read .env.local, and read it first", () => {
    /* FIRST is the assertion, not merely "present". `loadDotenv` is called
       with `override: false` and the loader returns as soon as it has a URL,
       so order IS precedence: a developer with both files gets whichever is
       opened first. `.env.local` is the local one and must win, the same way
       `packages/api/test/setup.ts` lets it override `.env`. */
    const source = read("tools/seed-demo.ts");
    const list = source.match(/for \(const file of \[([^\]]+)\]\)/);
    expect(list, "seed-demo.ts no longer loops over a list of env files — did it move?")
      .not.toBeNull();
    const files = (list?.[1] as string).match(/"\.[^"]+"/g) ?? [];
    expect(files[0]).toBe('".env.local"');
    expect(files).toContain('".env"');
  });

  it("has .env.example point at the file dev:local opens", () => {
    /* The line this replaces said "Copy to `.env`", which is what sent people
       to the wrong file for months. `.env` is still named in the template,
       because drizzle-kit and the smoke harnesses do read it — what must not
       come back is the instruction to put local development there. */
    const template = read(".env.example");
    expect(template).toMatch(/cp \.env\.example \.env\.local/);
    expect(
      template,
      "`.env.example` tells developers to copy it to `.env`, which is not the " +
        "file `scripts/dev-local.sh` reads. That instruction is the original bug.",
    ).not.toMatch(/Copy to `\.env` at the repo root/);
  });

  it("keeps README and AGENTS.md naming .env.local for local work", () => {
    expect(read("README.md")).toMatch(/\.env\.local/);
    expect(read("AGENTS.md")).toMatch(/\.env\.local/);
  });
});

describe("the local database is one a developer can actually create", () => {
  it("ships a compose file on the image CI uses", () => {
    /* The migrations declare `vector` columns, so a stock Postgres fails
       `pnpm db:migrate` with `type "vector" does not exist` — which reads as
       a broken migration rather than a missing extension. Pinning the compose
       file to CI's own image is also what stops "passes locally, fails in
       CI" from being a database difference. */
    const ciImage = read(".github/workflows/ci.yml").match(/image:\s*(pgvector\/pgvector:\S+)/);
    expect(ciImage, "CI no longer names a pgvector image — did the service move?").not.toBeNull();

    const compose = read("docker-compose.yml");
    expect(compose).toContain(ciImage?.[1] as string);
    expect(
      compose,
      "the local database must bind to loopback only — it holds development " +
        "data behind a password committed to this repository.",
    ).toMatch(/"127\.0\.0\.1:5432:5432"/);
  });

  it("tells the reader about the extension the migrations need", () => {
    /* Both places a person might look. The compose file is where they will be
       when the container is up; the README is where they will be before it. */
    expect(read("docker-compose.yml")).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);
    expect(read("README.md")).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);
  });
});

describe("the whole verification set has one name", () => {
  it("has a root test script that runs every package", () => {
    /* `pnpm test` at the root printed "Command 'test' not found" until
       2026-08-28: the five commands were listed in README's "Verifying" and
       nowhere else, so the first thing anyone types on a new repo failed. */
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts.test, "the root `test` script is gone; `pnpm test` fails again").toBeDefined();
    expect(scripts.typecheck).toBeDefined();
    for (const pkg of ["@waka/api", "@waka/web"]) {
      expect(`${scripts.test} ${scripts.typecheck}`).toContain(pkg);
    }
    expect(`${scripts.test} ${scripts.typecheck}`).toContain("@waka/admin");
  });
});
