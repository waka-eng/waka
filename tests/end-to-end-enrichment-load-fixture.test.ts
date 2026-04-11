import assert from "node:assert/strict";
import test from "node:test";

import { INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING } from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import {
  assertEndToEndEnrichmentLoadLatencyReport,
  assertEndToEndEnrichmentLoadRunReport,
  assertExpectedEnrichmentLoadRequiredAiFields,
  ExpectedEnrichmentLoadMissingRequiredRequestFieldsError,
  assertExpectedEnrichmentLoadRunFinalRecords,
  buildEndToEndEnrichmentCaptureRequest,
  buildEndToEndEnrichmentCorrelationId,
  createExpectedEnrichmentLoadFixture,
  DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS,
  EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
  generateEndToEndEnrichmentLoadLatencyReport,
  generateEndToEndEnrichmentLoadRunReport,
  runEndToEndEnrichmentLoadFixture,
  waitForEndToEndEnrichmentLoadRunTerminalState,
} from "./helpers/end-to-end-enrichment-load-fixture.ts";

test("runEndToEndEnrichmentLoadFixture submits each generated capture item through the async enrichment entrypoint", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 3,
    sourceTypeSequence: ["TEXT_NOTE", "VOICE_NOTE", "URL_IMPORT"],
    userId: "user_end_to_end_harness",
  });

  const result = await runEndToEndEnrichmentLoadFixture({
    fixture,
  });

  assert.equal(result.submissions.length, fixture.captures.length);
  assert.equal(result.finalRecords.length, fixture.captures.length);
  assert.equal(result.pipelineCompletions.length, fixture.captures.length);
  assert.deepEqual(result.completionTracking, result.pipelineCompletions);
  assert.equal(result.report.items.length, fixture.captures.length);
  assert.equal(result.report.metrics.expectedItemCount, fixture.captures.length);
  assert.equal(result.report.metrics.submittedItemCount, fixture.captures.length);
  assert.equal(result.report.metrics.processedItemCount, fixture.captures.length);
  assert.equal(
    result.report.metrics.successfulTerminalItemCount,
    fixture.captures.length,
  );
  assert.equal(result.report.metrics.completedItemCount, fixture.captures.length);
  assert.equal(result.report.metrics.missingItemCount, 0);
  assert.equal(result.report.metrics.nonTerminalItemCount, 0);
  assert.equal(result.report.metrics.unprocessedItemCount, 0);
  assert.equal(result.report.metrics.incompleteItemCount, 0);
  assert.equal(result.report.metrics.completionRate, 1);
  assert.equal(result.report.metrics.processingRate, 1);
  assert.equal(result.report.metrics.averageSubmitToProcessStartMs, 1_000);
  assert.equal(result.report.metrics.averageProcessingDurationMs, 1_000);
  assert.equal(result.report.metrics.averageSubmitToCompleteMs, 2_000);
  assert.deepEqual(result.report.incompleteItems, []);
  assert.equal(result.latencyReport.items.length, fixture.captures.length);
  assert.equal(result.latencyReport.summary.totalItemCount, fixture.captures.length);
  assert.equal(result.latencyReport.summary.measuredItemCount, fixture.captures.length);
  assert.equal(result.latencyReport.summary.averageTimeToFullAiPopulationMs, 2_000);
  assert.equal(result.latencyReport.summary.maxTimeToFullAiPopulationMs, 2_000);
  assert.equal(
    result.latencyReport.summary.latencyBudgetMs,
    DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS,
  );
  assert.equal(result.latencyReport.summary.failedItemCount, 0);
  assert.equal(result.latencyReport.summary.passedItemCount, fixture.captures.length);
  assert.equal(result.latencyReport.summary.passed, true);
  assert.equal(result.latencyReport.summary.status, "PASS");
  assert.deepEqual(result.latencyReport.summary.failedCaptureIds, []);

  for (const [index, submission] of result.submissions.entries()) {
    assert.equal(submission.responseStatus, 201);
    assert.equal(submission.responseBody.id, submission.capture.id);
    assert.equal(submission.responseBody.rawContent, submission.capture.request.rawContent);
    assert.equal(submission.responseBody.sourceType, submission.capture.sourceType);
    assert.equal(submission.queuePayload.jobType, "ai_enrichment");
    assert.equal(submission.queuePayload.inspirationId, submission.capture.id);
    assert.equal(
      submission.createArgs.data.sourceMeta?.correlationId,
      submission.correlationId,
    );
    assert.equal(submission.createArgs.data.userId, fixture.options.userId);
    assert.deepEqual(submission.pipelineUpdateArgs.where.userId_id, {
      id: submission.capture.id,
      userId: fixture.options.userId,
    });
    assert.equal(
      submission.processingRequest.metadata.messageId,
      submission.correlationId,
    );
    assert.equal(
      submission.processingRequest.metadata.messageAttributes?.correlationId?.stringValue,
      submission.correlationId,
    );
    assert.deepEqual(submission.processingRequest.payload, submission.queuePayload);
    assert.equal(
      submission.submittedAt,
      submission.capture.timestamps.captureStartedAt,
    );
    assert.equal(submission.startedProcessingAt, submission.processingStartedAt);
    assert.equal(submission.completedAt, submission.processingCompletedAt);
    assert.equal(
      submission.processingStartedAt,
      submission.capture.timestamps.ingestStartedAt,
    );
    assert.equal(
      submission.processingCompletedAt,
      submission.capture.timestamps.aiFieldsCompletedAt,
    );
    assert.equal(
      new Date(submission.submittedAt).getTime() <
        new Date(submission.processingStartedAt).getTime(),
      true,
    );
    assert.equal(
      new Date(submission.processingStartedAt).getTime() <
        new Date(submission.processingCompletedAt).getTime(),
      true,
    );

    const completion = result.pipelineCompletions[index]!;
    assert.equal(completion.correlationId, submission.correlationId);
    assert.equal(completion.submittedAt, submission.submittedAt);
    assert.equal(
      completion.processingStartedAt,
      submission.processingStartedAt,
    );
    assert.equal(
      completion.processingCompletedAt,
      submission.processingCompletedAt,
    );

    const reportItem = result.report.items[index]!;
    assert.equal(reportItem.captureId, submission.capture.id);
    assert.equal(reportItem.correlationId, submission.correlationId);
    assert.equal(reportItem.missing, false);
    assert.equal(reportItem.processed, true);
    assert.equal(reportItem.completed, true);
    assert.equal(reportItem.successfulTerminalState, true);
    assert.equal(
      reportItem.completedFieldCount,
      EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS.length,
    );
    assert.deepEqual(reportItem.incompleteFieldNames, []);
    assert.equal(reportItem.submitToProcessStartMs, 1_000);
    assert.equal(reportItem.processingDurationMs, 1_000);
    assert.equal(reportItem.submitToCompleteMs, 2_000);

    const latencyItem = result.latencyReport.items[index]!;
    assert.equal(latencyItem.captureId, submission.capture.id);
    assert.equal(latencyItem.captureOrdinal, submission.capture.captureOrdinal);
    assert.equal(latencyItem.correlationId, submission.correlationId);
    assert.equal(latencyItem.timeToFullAiPopulationMs, 2_000);
    assert.equal(latencyItem.latencyBudgetMs, 30_000);
    assert.equal(latencyItem.failureReason, null);
    assert.equal(latencyItem.passed, true);
    assert.equal(latencyItem.status, "PASS");
    assert.equal(latencyItem.thresholdMissDiagnostics, null);
  }

  const voiceSubmission = result.submissions[1]!;
  assert.equal(
    voiceSubmission.responseBody.audioStorageUrl,
    fixture.captures[1]!.request.audioStorageUrl,
  );
  assert.equal(
    voiceSubmission.responseBody.audioStorageKey,
    fixture.captures[1]!.request.audioStorageKey,
  );

  const firstFinalRecord = result.finalRecords[0]!;
  assertExpectedEnrichmentLoadRequiredAiFields(firstFinalRecord);
  assert.equal(firstFinalRecord.id, fixture.captures[0]!.id);
  assert.equal(firstFinalRecord.enrichmentStatus, "COMPLETED");
  assert.equal(firstFinalRecord.title, "Deterministic enriched title");
  assert.equal(
    firstFinalRecord.summary,
    "A deterministic enrichment summary for the correlated capture.",
  );
  assert.deepEqual(firstFinalRecord.tags, ["capture", "cluster", "connection"]);
  assert.equal(firstFinalRecord.embedding?.length, 1_536);
  assert.equal(
    firstFinalRecord.enrichmentFields?.summary.status,
    "COMPLETED",
  );
});

test("waitForEndToEndEnrichmentLoadRunTerminalState defers field assertions until the run reaches a successful terminal state", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 1,
    userId: "user_end_to_end_terminal_wait",
  });
  const result = await runEndToEndEnrichmentLoadFixture({
    fixture,
  });
  const delayedFinalRecords = structuredClone(result.finalRecords);
  delayedFinalRecords[0]!.enrichmentCompletedAt = null;
  delayedFinalRecords[0]!.enrichmentStatus =
    INSPIRATION_ENRICHMENT_STATUS_PROCESSING;
  let loadAttempts = 0;

  const verification = await waitForEndToEndEnrichmentLoadRunTerminalState({
    fixture,
    loadFinalRecords: async () => {
      loadAttempts += 1;
      return loadAttempts === 1 ? delayedFinalRecords : result.finalRecords;
    },
    pipelineCompletions: result.pipelineCompletions,
    pollIntervalMs: 0,
    sleep: async () => {},
    submissions: result.submissions,
  });

  assert.equal(loadAttempts, 2);
  assert.equal(verification.attemptCount, 2);
  assert.equal(verification.report.metrics.nonTerminalItemCount, 0);
  assert.equal(verification.report.items[0]?.successfulTerminalState, true);
  assert.deepEqual(verification.report.items[0]?.incompleteFieldNames, []);
});

test("waitForEndToEndEnrichmentLoadRunTerminalState fails when a completed expected-load capture exceeds the 30-second AI population budget", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 1,
    userId: "user_end_to_end_terminal_latency_budget",
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

  await assert.rejects(
    () =>
      waitForEndToEndEnrichmentLoadRunTerminalState({
        fixture,
        loadFinalRecords: async () => result.finalRecords,
        pipelineCompletions: slowPipelineCompletions,
        pollIntervalMs: 0,
        sleep: async () => {},
        submissions: result.submissions,
      }),
    new RegExp(
      `Expected-load latency report failed: ${fixture.captures[0]!.id} \\[Time to full AI population ${slowLatencyMs}ms exceeds the ${DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS}ms budget by 1500ms\\.[\\s\\S]*processing_duration=30500ms[\\s\\S]*Focus: Investigate in-worker AI generation and persistence latency during enrichment processing\\.`,
    ),
  );
});

test("generateEndToEndEnrichmentLoadLatencyReport marks captures that exceed the AI population budget or never fully populate", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 3,
    userId: "user_end_to_end_latency_failures",
  });
  const result = await runEndToEndEnrichmentLoadFixture({
    fixture,
  });
  const slowPipelineCompletions = structuredClone(result.pipelineCompletions);
  const slowLatencyMs =
    DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS + 1_500;
  const slowCapture = fixture.captures[1]!;
  const slowCompletedAt = new Date(
    new Date(slowCapture.timestamps.captureStartedAt).getTime() + slowLatencyMs,
  ).toISOString();

  slowPipelineCompletions[1]!.processingCompletedAt = slowCompletedAt;
  slowPipelineCompletions[1]!.completedAt = slowCompletedAt;

  const incompleteFinalRecords = structuredClone(result.finalRecords);
  incompleteFinalRecords[2]!.summary = null;

  const report = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: incompleteFinalRecords,
    fixture,
    pipelineCompletions: slowPipelineCompletions,
    submissions: result.submissions,
  });
  const latencyReport = generateEndToEndEnrichmentLoadLatencyReport({
    report,
  });

  assert.equal(latencyReport.items[0]!.timeToFullAiPopulationMs, 2_000);
  assert.equal(latencyReport.items[0]!.status, "PASS");
  assert.equal(latencyReport.items[0]!.thresholdMissDiagnostics, null);
  assert.equal(latencyReport.items[1]!.timeToFullAiPopulationMs, slowLatencyMs);
  assert.equal(latencyReport.items[1]!.status, "FAIL");
  assert.equal(
    latencyReport.items[1]!.thresholdMissDiagnostics?.budgetExceededMs,
    1_500,
  );
  assert.equal(
    latencyReport.items[1]!.thresholdMissDiagnostics?.focusArea,
    "AI_PROCESSING",
  );
  assert.equal(
    latencyReport.items[1]!.thresholdMissDiagnostics?.slowestStepName,
    "processing_duration",
  );
  assert.equal(
    latencyReport.items[1]!.thresholdMissDiagnostics?.slowestStepDurationMs,
    30_500,
  );
  assert.deepEqual(
    latencyReport.items[1]!.thresholdMissDiagnostics?.stepDiagnostics,
    [
      {
        durationMs: 1_000,
        label: "capture-to-processing-start",
        stepName: "capture_to_processing_start",
      },
      {
        durationMs: 30_500,
        label: "processing-duration",
        stepName: "processing_duration",
      },
    ],
  );
  assert.match(
    latencyReport.items[1]!.failureReason ?? "",
    new RegExp(
      `exceeds the ${DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS}ms budget by 1500ms`,
    ),
  );
  assert.match(
    latencyReport.items[1]!.failureReason ?? "",
    /processing_duration=30500ms/,
  );
  assert.equal(latencyReport.items[2]!.timeToFullAiPopulationMs, null);
  assert.equal(latencyReport.items[2]!.status, "FAIL");
  assert.equal(latencyReport.items[2]!.thresholdMissDiagnostics, null);
  assert.match(
    latencyReport.items[2]!.failureReason ?? "",
    /did not fully populate AI fields: summary/,
  );
  assert.equal(latencyReport.summary.totalItemCount, fixture.captures.length);
  assert.equal(latencyReport.summary.measuredItemCount, 2);
  assert.equal(
    latencyReport.summary.averageTimeToFullAiPopulationMs,
    (2_000 + slowLatencyMs) / 2,
  );
  assert.equal(latencyReport.summary.maxTimeToFullAiPopulationMs, slowLatencyMs);
  assert.equal(latencyReport.summary.failedItemCount, 2);
  assert.equal(latencyReport.summary.passedItemCount, 1);
  assert.equal(latencyReport.summary.passed, false);
  assert.equal(latencyReport.summary.status, "FAIL");
  assert.deepEqual(latencyReport.summary.failedCaptureIds, [
    fixture.captures[1]!.id,
    fixture.captures[2]!.id,
  ]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadLatencyReport(latencyReport),
    new RegExp(
      `Expected-load latency report failed: ${fixture.captures[1]!.id} \\[Time to full AI population ${slowLatencyMs}ms exceeds the ${DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS}ms budget by 1500ms\\.[\\s\\S]*processing_duration=30500ms[\\s\\S]*${fixture.captures[2]!.id} \\[Capture did not fully populate AI fields: summary\\.\\]`,
    ),
  );
});

test("assertExpectedEnrichmentLoadRunFinalRecords fails when any produced item is missing a required AI enrichment value", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 2,
    userId: "user_end_to_end_per_item_verification",
  });
  const result = await runEndToEndEnrichmentLoadFixture({
    fixture,
  });
  const invalidFinalRecords = structuredClone(result.finalRecords);

  invalidFinalRecords[1]!.tags = [];

  assert.throws(
    () => assertExpectedEnrichmentLoadRunFinalRecords(invalidFinalRecords),
    new RegExp(
      `Expected-load final record ${fixture.captures[1]!.id} is missing required AI enrichment fields: tags\\.`,
    ),
  );
});

test("end-to-end enrichment correlation IDs are stable and the request builder injects them without mutating the source fixture", () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 2,
  });
  const firstCapture = fixture.captures[0]!;
  const secondCapture = fixture.captures[1]!;

  const firstCorrelationId = buildEndToEndEnrichmentCorrelationId(firstCapture);
  const repeatedFirstCorrelationId =
    buildEndToEndEnrichmentCorrelationId(firstCapture);
  const secondCorrelationId = buildEndToEndEnrichmentCorrelationId(secondCapture);

  assert.equal(firstCorrelationId, repeatedFirstCorrelationId);
  assert.notEqual(firstCorrelationId, secondCorrelationId);
  assert.equal(firstCapture.request.sourceMeta?.correlationId, undefined);

  const requestBody = buildEndToEndEnrichmentCaptureRequest(firstCapture, {
    authenticatedUserId: "user_override",
  });

  assert.equal(requestBody.sourceMeta?.correlationId, firstCorrelationId);
  assert.equal(requestBody.sourceMeta?.userId, "user_override");
  assert.equal(firstCapture.request.sourceMeta?.correlationId, undefined);
});

test("runEndToEndEnrichmentLoadFixture reports missing required request fields with payload context", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 1,
    sourceTypeSequence: ["PHOTO"],
    userId: "user_end_to_end_missing_request_fields",
  });
  const capture = fixture.captures[0]!;

  capture.request = {
    ...capture.request,
    mediaUrl: undefined,
    transcript: undefined,
  };

  await assert.rejects(
    () => runEndToEndEnrichmentLoadFixture({ fixture }),
    (error) => {
      assert(error instanceof ExpectedEnrichmentLoadMissingRequiredRequestFieldsError);
      assert.match(
        error.message,
        new RegExp(
          `Expected-load capture ${capture.id} \\(PHOTO\\) request payload is missing required fields: mediaUrl, transcript\\.`,
        ),
      );
      assert.deepEqual(error.diagnostic.missingFieldNames, [
        "mediaUrl",
        "transcript",
      ]);
      assert.deepEqual(error.diagnostic.payloadContext, {
        captureId: capture.id,
        payload: buildEndToEndEnrichmentCaptureRequest(capture),
        requiredFieldNames: capture.expected.requiredRequestFields,
        sourceType: "PHOTO",
      });
      return true;
    },
  );
});

test("end-to-end enrichment run report validation fails when captures are missing, unprocessed, or incomplete", async () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 3,
    userId: "user_end_to_end_report_failures",
  });
  const result = await runEndToEndEnrichmentLoadFixture({
    fixture,
  });

  const missingReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: result.finalRecords.slice(1),
    fixture,
    pipelineCompletions: result.pipelineCompletions.slice(1),
    submissions: result.submissions.slice(1),
  });

  assert.equal(missingReport.metrics.missingItemCount, 1);
  assert.deepEqual(missingReport.metrics.missingCaptureIds, [fixture.captures[0]!.id]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(missingReport),
    /missing captures: insp_capture-reliability_001/,
  );

  const unprocessedReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: result.finalRecords.filter(
      (record) => record.id !== fixture.captures[1]!.id,
    ),
    fixture,
    pipelineCompletions: result.pipelineCompletions.filter(
      (completion) => completion.capture.id !== fixture.captures[1]!.id,
    ),
    submissions: result.submissions,
  });

  assert.equal(unprocessedReport.metrics.unprocessedItemCount, 1);
  assert.deepEqual(unprocessedReport.metrics.unprocessedCaptureIds, [
    fixture.captures[1]!.id,
  ]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(unprocessedReport),
    /unprocessed captures: insp_semantic-clustering_002/,
  );

  const nonTerminalFinalRecords = structuredClone(result.finalRecords);
  nonTerminalFinalRecords[2]!.enrichmentCompletedAt = null;
  nonTerminalFinalRecords[2]!.enrichmentStatus =
    INSPIRATION_ENRICHMENT_STATUS_PROCESSING;
  const nonTerminalReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: nonTerminalFinalRecords,
    fixture,
    pipelineCompletions: result.pipelineCompletions,
    submissions: result.submissions,
  });

  assert.equal(nonTerminalReport.metrics.nonTerminalItemCount, 1);
  assert.deepEqual(nonTerminalReport.metrics.nonTerminalCaptureIds, [
    fixture.captures[2]!.id,
  ]);
  assert.deepEqual(nonTerminalReport.incompleteItems, []);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(nonTerminalReport),
    /captures missing successful terminal state: insp_cross-surface-capture_003 \[PROCESSING\]/,
  );

  const incompleteFinalRecords = structuredClone(result.finalRecords);
  incompleteFinalRecords[2]!.enrichmentFields!.summary.status =
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING;
  incompleteFinalRecords[2]!.enrichmentFields!.summary.completedAt = null;
  incompleteFinalRecords[2]!.enrichmentStatus =
    INSPIRATION_ENRICHMENT_STATUS_COMPLETED;
  const incompleteReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: incompleteFinalRecords,
    fixture,
    pipelineCompletions: result.pipelineCompletions,
    submissions: result.submissions,
  });

  assert.equal(incompleteReport.metrics.incompleteItemCount, 1);
  assert.deepEqual(incompleteReport.incompleteItems, [
    {
      captureId: fixture.captures[2]!.id,
      incompleteFieldNames: ["summary"],
    },
  ]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(incompleteReport),
    /incomplete captures: insp_cross-surface-capture_003 \[summary\]/,
  );

  const missingValueFinalRecords = structuredClone(result.finalRecords);
  missingValueFinalRecords[2]!.summary = null;
  const missingValueReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: missingValueFinalRecords,
    fixture,
    pipelineCompletions: result.pipelineCompletions,
    submissions: result.submissions,
  });

  assert.equal(missingValueReport.metrics.incompleteItemCount, 1);
  assert.deepEqual(missingValueReport.incompleteItems, [
    {
      captureId: fixture.captures[2]!.id,
      incompleteFieldNames: ["summary"],
    },
  ]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(missingValueReport),
    /incomplete captures: insp_cross-surface-capture_003 \[summary\]/,
  );

  const blankValueFinalRecords = structuredClone(result.finalRecords);
  blankValueFinalRecords[2]!.summary = "   ";
  const blankValueReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: blankValueFinalRecords,
    fixture,
    pipelineCompletions: result.pipelineCompletions,
    submissions: result.submissions,
  });

  assert.equal(blankValueReport.metrics.incompleteItemCount, 1);
  assert.deepEqual(blankValueReport.incompleteItems, [
    {
      captureId: fixture.captures[2]!.id,
      incompleteFieldNames: ["summary"],
    },
  ]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(blankValueReport),
    /incomplete captures: insp_cross-surface-capture_003 \[summary\]/,
  );

  const emptyTagsFinalRecords = structuredClone(result.finalRecords);
  emptyTagsFinalRecords[2]!.tags = [];
  const emptyTagsReport = generateEndToEndEnrichmentLoadRunReport({
    finalRecords: emptyTagsFinalRecords,
    fixture,
    pipelineCompletions: result.pipelineCompletions,
    submissions: result.submissions,
  });

  assert.equal(emptyTagsReport.metrics.incompleteItemCount, 1);
  assert.deepEqual(emptyTagsReport.incompleteItems, [
    {
      captureId: fixture.captures[2]!.id,
      incompleteFieldNames: ["tags"],
    },
  ]);
  assert.throws(
    () => assertEndToEndEnrichmentLoadRunReport(emptyTagsReport),
    /incomplete captures: insp_cross-surface-capture_003 \[tags\]/,
  );
});
