import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  END_TO_END_EXPECTED_LOAD_VERIFICATION_SCENARIO,
  createFailedEndToEndEnrichmentLoadVerificationOutput,
  parseVerifyEndToEndEnrichmentLoadArgs,
  runEndToEndEnrichmentLoadVerification,
} from "../scripts/verify-end-to-end-enrichment-load.ts";
import {
  assertEndToEndEnrichmentLoadLatencyReport,
  buildEndToEndEnrichmentCaptureRequest,
  createExpectedEnrichmentLoadFixture,
  DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS,
  ExpectedEnrichmentLoadMissingRequiredRequestFieldsError,
  generateEndToEndEnrichmentLoadLatencyReport,
  generateEndToEndEnrichmentLoadRunReport,
  runEndToEndEnrichmentLoadFixture,
} from "./helpers/end-to-end-enrichment-load-fixture.ts";

test("parseVerifyEndToEndEnrichmentLoadArgs accepts capture volume, output path, and user overrides", () => {
  assert.deepEqual(
    parseVerifyEndToEndEnrichmentLoadArgs([
      "--",
      "--capture-volume",
      "3",
      "--user-id=user_expected_load_runner",
      "--output",
      "reports/expected-load.json",
    ]),
    {
      captureVolume: 3,
      outputPath: "reports/expected-load.json",
      userId: "user_expected_load_runner",
    },
  );
});

test("runEndToEndEnrichmentLoadVerification returns structured PASS output for the expected-load harness", async () => {
  const output = await runEndToEndEnrichmentLoadVerification({
    captureVolume: 3,
    userId: "user_expected_load_script_pass",
  });

  assert.equal(output.status, "PASS");
  assert.equal(output.passed, true);
  assert.equal(output.error, null);
  assert.equal(output.scenario, END_TO_END_EXPECTED_LOAD_VERIFICATION_SCENARIO);
  assert.equal(output.fixture?.summary.captureVolume, 3);
  assert.equal(output.verification.runReport?.metrics.expectedItemCount, 3);
  assert.equal(output.verification.runReport?.metrics.completedItemCount, 3);
  assert.equal(output.verification.latencyReport?.summary.status, "PASS");
  assert.equal(output.verification.latencyReport?.summary.failedItemCount, 0);
  assert.match(output.message, /^PASS:/);
});

test("verify-end-to-end-enrichment-load entrypoint writes JSON output and exits zero on success", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "waka-expected-load-"));
  const outputPath = path.join(tempDirectory, "verification.json");
  const result = spawnSync(
    "node",
    [
      "scripts/verify-end-to-end-enrichment-load.ts",
      "--capture-volume",
      "2",
      "--user-id",
      "user_expected_load_spawn_pass",
      "--output",
      outputPath,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stderr, /^PASS:/m);

  const stdoutPayload = JSON.parse(
    result.stdout,
  ) as Awaited<ReturnType<typeof runEndToEndEnrichmentLoadVerification>>;
  const filePayload = JSON.parse(
    readFileSync(outputPath, "utf8"),
  ) as Awaited<ReturnType<typeof runEndToEndEnrichmentLoadVerification>>;

  assert.equal(stdoutPayload.status, "PASS");
  assert.equal(stdoutPayload.passed, true);
  assert.equal(stdoutPayload.fixture?.summary.captureVolume, 2);
  assert.deepEqual(filePayload, stdoutPayload);
});

test("verify-end-to-end-enrichment-load entrypoint writes JSON output and exits nonzero on failure", () => {
  const result = spawnSync(
    "node",
    [
      "scripts/verify-end-to-end-enrichment-load.ts",
      "--capture-volume",
      "0",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL:/m);

  const stdoutPayload = JSON.parse(
    result.stdout,
  ) as Awaited<ReturnType<typeof runEndToEndEnrichmentLoadVerification>>;

  assert.equal(stdoutPayload.status, "FAIL");
  assert.equal(stdoutPayload.passed, false);
  assert.equal(stdoutPayload.fixture, null);
  assert.equal(stdoutPayload.verification.runReport, null);
  assert.equal(stdoutPayload.verification.latencyReport, null);
  assert.match(stdoutPayload.error?.message ?? "", /captureVolume must be a positive integer/);
});

test("createFailedEndToEndEnrichmentLoadVerificationOutput preserves latency diagnostics for threshold misses", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 1,
    userId: "user_expected_load_script_latency_failure",
  });
  const result = await runEndToEndEnrichmentLoadFixture({
    fixture,
  });
  const slowPipelineCompletions = structuredClone(result.pipelineCompletions);
  const slowLatencyMs =
    DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS + 1_500;
  const slowCompletedAt = new Date(
    new Date(fixture.captures[0]!.timestamps.captureStartedAt).getTime() +
      slowLatencyMs,
  ).toISOString();

  slowPipelineCompletions[0]!.processingCompletedAt = slowCompletedAt;
  slowPipelineCompletions[0]!.completedAt = slowCompletedAt;

  const runReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: result.finalRecords,
    fixture,
    pipelineCompletions: slowPipelineCompletions,
    submissions: result.submissions,
  });
  const latencyReport = generateEndToEndEnrichmentLoadLatencyReport({
    report: runReport,
  });
  const error = await (async () => {
    try {
      assertEndToEndEnrichmentLoadLatencyReport(latencyReport, {
        runReport,
      });
      throw new Error("Expected latency assertion to fail.");
    } catch (caughtError) {
      return caughtError;
    }
  })();
  const output = createFailedEndToEndEnrichmentLoadVerificationOutput({
    error,
    fixture,
    options: {
      captureVolume: 1,
      userId: fixture.options.userId,
    },
  });

  assert.equal(output.status, "FAIL");
  assert.equal(output.passed, false);
  assert.equal(output.fixture?.summary.captureVolume, 1);
  assert.equal(output.verification.runReport?.metrics.expectedItemCount, 1);
  assert.equal(output.verification.latencyReport?.summary.status, "FAIL");
  assert.equal(
    output.verification.latencyReport?.items[0]?.thresholdMissDiagnostics?.focusArea,
    "AI_PROCESSING",
  );
  assert.equal(
    output.verification.latencyReport?.items[0]?.thresholdMissDiagnostics?.budgetExceededMs,
    1_500,
  );
  assert.match(output.message, /processing_duration=30500ms/);
});

test("createFailedEndToEndEnrichmentLoadVerificationOutput preserves missing required request field diagnostics", () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 1,
    sourceTypeSequence: ["PHOTO"],
    userId: "user_expected_load_script_missing_request_fields",
  });
  const capture = fixture.captures[0]!;

  capture.request = {
    ...capture.request,
    mediaUrl: undefined,
    transcript: undefined,
  };

  const error = new ExpectedEnrichmentLoadMissingRequiredRequestFieldsError({
    missingFieldNames: ["mediaUrl", "transcript"],
    payloadContext: {
      captureId: capture.id,
      payload: buildEndToEndEnrichmentCaptureRequest(capture),
      requiredFieldNames: capture.expected.requiredRequestFields,
      sourceType: capture.sourceType,
    },
  });
  const output = createFailedEndToEndEnrichmentLoadVerificationOutput({
    error,
    fixture,
    options: {
      captureVolume: 1,
      userId: fixture.options.userId,
    },
  });

  assert.equal(output.status, "FAIL");
  assert.equal(output.passed, false);
  assert.equal(output.error?.details?.kind, "missing_required_request_fields");
  assert.deepEqual(output.error?.details?.missingFieldNames, [
    "mediaUrl",
    "transcript",
  ]);
  assert.deepEqual(output.error?.details?.payloadContext, {
    captureId: capture.id,
    payload: buildEndToEndEnrichmentCaptureRequest(capture),
    requiredFieldNames: capture.expected.requiredRequestFields,
    sourceType: "PHOTO",
  });
  assert.match(output.message, /missing required fields: mediaUrl, transcript/);
});
