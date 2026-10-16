/**
 * Vitest configuration for the @waka/api package.
 *
 * Why this lives here (and not at the repo root)
 * -----------------------------------------------
 * The Seed contract pins the test corpus to `packages/api/test/**.test.ts`
 * and reserves vitest for the server-side surface area (signup, login,
 * inspiration CRUD, presigned URL issuance, classify queue handler).
 * The web package is decomposed React + Vite and currently has no
 * vitest target in scope — keeping the runner scoped to the API package
 * means `pnpm --filter @waka/api test` is the single canonical entry.
 *
 * Environment
 * -----------
 * The Hono app is exercised in-process via `app.request(...)` (see the
 * existing `*.smoke.ts` scripts) and the queue worker imports AWS SDK +
 * Drizzle. Both are pure Node — there is no DOM, no JSX, no React. We
 * therefore pin `environment: "node"`. Using "jsdom" here would only slow
 * the suite down and risk masking server-only globals.
 *
 * Module resolution
 * -----------------
 * Source files import siblings with explicit `.js` suffixes (e.g.
 * `import { users } from "../db/index.js"`) because the package is
 * authored as ESM with NodeNext resolution. Vite's resolver handles that
 * out of the box — no `extensionAlias` shim is needed — provided we keep
 * `resolve.alias` light.
 *
 * Path alias
 * ----------
 * `@/` → `src/` is added so test files under `test/` can reach internal
 * modules without long `../../src` chains. This mirrors the convention
 * already used in many monorepos and keeps test imports stable as the
 * source tree evolves.
 *
 * Setup file
 * ----------
 * `test/setup.ts` is referenced as a global setup hook. The file itself
 * is created by the next sub-AC; declaring it here first means the
 * subsequent change is purely additive (drop in the file, no config
 * churn). Vitest tolerates a missing setup file at config-load time but
 * will fail any run until the file exists, which is the desired
 * tripwire — a green run requires the setup file to be wired.
 *
 * Coverage
 * --------
 * The v8 provider is the modern default (no Babel instrumentation, no
 * separate dependency tree beyond what Node ships). We collect from
 * `src/**` only — never from `test/**` or generated drizzle migrations —
 * and emit `text` for terminal feedback plus `lcov` so CI / IDE plugins
 * (and any future codecov upload) have a machine-readable artifact.
 *
 * Thresholds are intentionally NOT pinned in this sub-AC. The first job
 * is to make the suite *runnable*; threshold tuning belongs with the
 * test corpus itself once the critical-path specs land.
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    /**
     * Pure-Node server runtime. See module header for rationale.
     */
    environment: "node",

    /**
     * Globals OFF — the smoke scripts already use explicit imports and
     * the new test files will follow suit. Keeping this off prevents
     * accidental reliance on ambient `expect` / `describe` and keeps the
     * type surface aligned with `noUnusedLocals` in tsconfig.
     */
    globals: false,

    // Test discovery scope.
    //
    // - test/<recursive>/*.test.ts is the Seed-blessed home for the
    //   proper isolated suite.
    // - src/<recursive>/*.test.ts is permitted so that future
    //   co-located unit tests (a pure helper sitting next to its
    //   module) need not be relocated.
    //
    // Existing *.smoke.ts scripts are intentionally NOT picked up —
    // they are tsx-driven one-shot scripts, not vitest specs, and
    // would fail under vitest because they call process.exit.
    //
    // (We use line comments here rather than a JSDoc block because the
    // glob patterns below contain "**\/" — an asterisk-asterisk-slash
    // sequence — and the literal "*\/" inside a /** ... */ block would
    // close the comment prematurely under esbuild's parser.)
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.sst/**",
      "**/*.smoke.ts",
    ],

    /**
     * Global setup — runs once before the suite starts. Used to load
     * `.env` (so DB_CONNECTION_URL / AUTH_SECRET / JWT_SECRET / etc. are
     * present), seed deterministic Math.random / Date stubs if needed,
     * and wire any module-level mocks (e.g. Gemini transport).
     *
     * The path is resolved relative to this config file.
     */
    setupFiles: [resolve(__dirname, "test/setup.ts")],

    /**
     * ONCE BEFORE EVERYTHING AND ONCE AFTER, for the two cases that need a
     * whole database rather than a schema. `CREATE`/`DROP DATABASE` are
     * cluster-wide and contend with concurrency — measured here at 0.25s
     * idle against 14-25s under this suite — so their cleanup runs when the
     * cluster is quiet instead of racing a hook timeout. See the file for
     * the measurements and why a longer timeout was the wrong answer twice.
     */
    globalSetup: [resolve(__dirname, "test/global-database-provision.ts")],

    /**
     * Default test timeout. Most specs hit Hono in-process and complete
     * in <100ms, but the queue/classifier path can fan out to mocked
     * Gemini + Drizzle and benefit from a slightly more generous budget.
     */
    testTimeout: 20_000,
    /**
     * beforeAll/afterAll hooks provision isolated test schemas (create +
     * migrate) against the configured Postgres. Against a remote managed DB
     * (e.g. Neon) that round-trips slower than a local instance, so 10s was
     * too tight and surfaced as "Hook timed out" cascades. 45s gives the
     * schema setup/teardown room without masking genuinely hung work.
     */
    hookTimeout: 45_000,

    /**
     * Reporter — `default` for local DX, plus `junit` for CI ingestion.
     * Output paths are stable so CI agents can pick them up without
     * configuration.
     */
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: {
      junit: resolve(__dirname, "test-results/junit.xml"),
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: resolve(__dirname, "coverage"),
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.smoke.ts",
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/db/index.ts", // pure barrel re-export
      ],
      // Threshold tuning is deferred until the test corpus exists.
      // Leaving thresholds unset means the run never fails on coverage,
      // which is correct while the suite is still being built out.
      all: true,
    },
  },
});
