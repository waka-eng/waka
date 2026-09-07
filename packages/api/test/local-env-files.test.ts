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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
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

  it("has drizzle-kit prefer .env.local, which the docs now promise", () => {
    /* THE LOADER THIS SUITE ORIGINALLY FORGOT. Its first version asserted the
       two loaders it had just changed and said nothing about `drizzle.config.ts`
       — so README could and did claim drizzle-kit reads `.env` instead, in a
       diff whose whole thesis is that the docs and the loaders must agree.
       The config loads `.env.local` FIRST and with `override` on, precisely so
       a placeholder in `.env` cannot win, which is why `pnpm db:migrate` needs
       nothing but `.env.local`. */
    const config = read("drizzle.config.ts");
    const localAt = config.indexOf('loadDotenv({ path: ".env.local"');
    const plainAt = config.indexOf('loadDotenv({ path: ".env"');
    expect(localAt, "drizzle.config.ts no longer loads .env.local").toBeGreaterThan(-1);
    expect(plainAt, "drizzle.config.ts no longer loads .env").toBeGreaterThan(-1);
    expect(localAt, ".env.local must be loaded before .env").toBeLessThan(plainAt);

    expect(
      read("README.md"),
      "README must not send developers to `.env` for drizzle-kit — it reads " +
        "`.env.local` and prefers it.",
    ).not.toMatch(/`drizzle-kit` \(so `pnpm db:migrate`/);
  });

  it("names no harness that does not exist", () => {
    /* `.env.example` and README both used to tell developers to maintain a
       second copy of the template for "the `*.smoke.ts` harnesses". There are
       none — the claim was inherited from the old template and repeated
       without checking. */
    const smokeFiles = execFileSync(
      "git",
      ["ls-files", "*.smoke.ts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    if (smokeFiles === "") {
      for (const doc of [".env.example", "README.md"]) {
        expect(read(doc), `${doc} names *.smoke.ts harnesses, and there are none`)
          .not.toMatch(/smoke\.ts/);
      }
    }
  });
});

describe("the local database is one a developer can actually create", () => {
  it("runs the local database on the same image as CI", () => {
    /* The reason is version parity with CI's service container, and only
       that. An earlier version of this test asserted the opposite reason —
       that the migrations need pgvector — which is false: embeddings are
       `jsonb` (`packages/api/src/db/schema-embeddings.ts`) and no migration
       declares a `vector` column. Pinning the false reason into CI would have
       kept a sentence alive that sends anyone with a stock Postgres 16 away
       from a server that runs this schema perfectly well. */
    const ciImage = read(".github/workflows/ci.yml").match(/image:\s*(pgvector\/pgvector:\S+)/);
    expect(ciImage, "CI no longer names that image — repoint the compose file").not.toBeNull();
    expect(read("docker-compose.yml")).toContain(ciImage?.[1] as string);
  });

  it("keeps the local database on loopback", () => {
    /* It holds development data behind a password committed to this
       repository. `"5432:5432"` would publish that on every interface. */
    expect(read("docker-compose.yml")).toMatch(/"127\.0\.0\.1:5432:5432"/);
  });

  it("keeps no migration needing a Postgres extension", () => {
    /* The claim the documentation now rests on, checked rather than trusted:
       if someone adds a `vector` column, three files start lying at once and
       this is where that gets caught. */
    /* SQL COMMENTS STRIPPED FIRST. Without this, `0011_an_edit_is_model_work.sql`
       fails on its own prose — "drops the stale vector (a delete, not a model
       call)" matches `vector\s*\(` perfectly well. A scanner that reads
       comments as code is the same defect this suite's sibling gate was fixed
       for in the same diff; it is easy to write twice. */
    const stripSql = (sql: string): string =>
      sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    const offenders = readdirSync(resolve(REPO_ROOT, "drizzle/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => /CREATE\s+EXTENSION|\bvector\s*\(|::vector\b|USING\s+(ivfflat|hnsw)/i
        .test(stripSql(readFileSync(resolve(REPO_ROOT, "drizzle/migrations", name), "utf8"))));
    expect(
      offenders,
      "a migration now needs a Postgres extension. README's \"A database\", " +
        "`docker-compose.yml` and `.env.example` all currently tell developers " +
        "any Postgres 16 will do. Update all three in this diff.",
    ).toEqual([]);
  });

  it("tells developers `up -d` alone does not wait for the database", () => {
    /* `up -d` returns when the container has started, not when Postgres is
       accepting connections; on a fresh volume initdb is still running, so
       the next command is refused. Nothing `depends_on` this service, so
       `--wait` is the only thing the healthcheck gates. */
    expect(read("README.md")).toMatch(/docker compose up -d --wait/);
    expect(read("docker-compose.yml")).toMatch(/--wait/);
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

    /* AGAINST `test` ALONE, NOT `test` AND `typecheck` CONCATENATED. The
       first version of this checked the two strings joined, so `@waka/admin`
       was satisfied by `typecheck`'s filter and admin's own vitest suite —
       `packages/admin/test/admin-api.test.ts` — never ran under the command
       README calls the whole verification set. A regression there was
       invisible while this test stayed green. */
    for (const pkg of ["@waka/api", "@waka/web", "@waka/admin"]) {
      expect(
        scripts.typecheck,
        `\`pnpm typecheck\` does not cover ${pkg}`,
      ).toContain(pkg);
    }
    for (const pkg of ["@waka/api", "@waka/web", "@waka/admin"]) {
      expect(
        scripts.test,
        `\`pnpm test\` does not run ${pkg}'s tests. Every package with a test ` +
          `script has to be in the one command, or its suite runs nowhere a ` +
          `contributor is told to look.`,
      ).toContain(pkg);
    }
  });
});
