import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The no-database suite: everything that runs on a bare checkout.
 *
 * `include` is a glob rather than a hand-maintained list of paths. A list
 * has one failure mode that matters more than its precision: a test file
 * nobody remembered to add never runs, and a test that never runs is
 * indistinguishable from a test that passes. Globbing inverts that — a new
 * test file is picked up automatically, and anything that genuinely cannot
 * run here has to be named below, where the reason is visible.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.sst/**",
      // Integration scripts, driven by hand against a live stack.
      "**/*.smoke.ts",
      /*
       * Tests of behaviour that lives IN the database — triggers, constraints,
       * cascades. A mock cannot execute a trigger, so these need a migrated
       * disposable Postgres and run under the full suite (`pnpm test`), which
       * has the setup guard that refuses a non-disposable target.
       *
       * The suffix is the contract rather than a list of paths, for the same
       * reason `include` is a glob: a new one is excluded automatically, and
       * naming it `.db.test.ts` is the author saying out loud that it needs a
       * database. Without this the file is collected here, finds no
       * connection, and fails in a way that reads as a broken test rather
       * than a misrouted one.
       */
      "**/*.db.test.ts",
    ],
  },
});
