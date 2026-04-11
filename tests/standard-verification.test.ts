import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_END_TO_END_ENRICHMENT_LOAD_REPORT_PATH,
  buildStandardVerificationSteps,
  parseStandardVerificationArgs,
  resolvePackageManagerExecutable,
} from "../scripts/run-standard-verification.ts";

test("parseStandardVerificationArgs supports skipping typecheck for the standard test path", () => {
  assert.deepEqual(parseStandardVerificationArgs(["--skip-typecheck"]), {
    skipTypecheck: true,
  });
});

test("parseStandardVerificationArgs rejects unknown flags", () => {
  assert.throws(
    () => parseStandardVerificationArgs(["--unexpected"]),
    /Unknown argument: --unexpected/,
  );
});

test("resolvePackageManagerExecutable honors PNPM_EXECUTABLE overrides before the platform default", () => {
  assert.equal(
    resolvePackageManagerExecutable({
      PNPM_EXECUTABLE: "pnpm-custom",
    }),
    "pnpm-custom",
  );
});

test("buildStandardVerificationSteps registers typecheck, node tests, and expected-load verification with a report artifact", () => {
  const steps = buildStandardVerificationSteps(
    {
      skipTypecheck: false,
    },
    {
      PNPM_EXECUTABLE: "pnpm-custom",
    },
  );

  assert.deepEqual(steps, [
    {
      args: ["run", "typecheck"],
      command: "pnpm-custom",
      name: "typecheck",
    },
    {
      args: ["--test", "tests/*.test.ts"],
      command: process.execPath,
      name: "node-tests",
    },
    {
      args: [
        "scripts/verify-end-to-end-enrichment-load.ts",
        "--output",
        path.join("reports", "end-to-end-enrichment-load-verification.json"),
      ],
      command: process.execPath,
      name: "expected-load",
    },
  ]);
  assert.equal(
    DEFAULT_END_TO_END_ENRICHMENT_LOAD_REPORT_PATH,
    path.join("reports", "end-to-end-enrichment-load-verification.json"),
  );
});

test("buildStandardVerificationSteps omits typecheck when the standard test path already skipped it", () => {
  const steps = buildStandardVerificationSteps(
    {
      skipTypecheck: true,
    },
    {
      PNPM_EXECUTABLE: "pnpm-custom",
    },
  );

  assert.deepEqual(steps.map((step) => step.name), [
    "node-tests",
    "expected-load",
  ]);
});
