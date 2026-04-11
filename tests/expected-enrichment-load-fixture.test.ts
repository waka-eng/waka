import assert from "node:assert/strict";
import test from "node:test";

import {
  createExpectedEnrichmentLoadFixture,
  DEFAULT_EXPECTED_ENRICHMENT_AI_FIELDS_COMPLETION_DELAY_MS,
  DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME,
  DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_MIN_SAMPLES,
  DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_TRIGGER_EVERY,
  DEFAULT_EXPECTED_ENRICHMENT_CONNECTION_LIMIT,
  DEFAULT_EXPECTED_ENRICHMENT_INGEST_START_DELAY_MS,
  DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS,
  EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
} from "./helpers/expected-enrichment-load-fixture.ts";

test("createExpectedEnrichmentLoadFixture produces the default Loop 7 expected-load workload", () => {
  const fixture = createExpectedEnrichmentLoadFixture();

  assert.equal(
    fixture.captures.length,
    DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME,
  );
  assert.equal(
    fixture.summary.aiEnrichmentJobCount,
    DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME,
  );
  assert.equal(
    fixture.summary.connectionAnalysisJobCount,
    DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME,
  );
  assert.deepEqual(
    fixture.summary.clusterRebuildTriggerOrdinals,
    Array.from(
      {
        length:
          DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME /
          DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_TRIGGER_EVERY,
      },
      (_, index) => (index + 1) * DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_TRIGGER_EVERY,
    ),
  );
  assert.deepEqual(
    fixture.summary.clusterableSemanticGroupKeys.sort(),
    DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS.map((group) => group.key).sort(),
  );
  assert.equal(
    fixture.summary.clusterableCaptureCount,
    DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME,
  );

  for (const group of DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS) {
    assert.equal(
      fixture.summary.semanticGroupBreakdown[group.key],
      DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME /
        DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS.length,
    );
  }
});

test("createExpectedEnrichmentLoadFixture emits request bodies and job metadata that match the enrichment flow", () => {
  const fixture = createExpectedEnrichmentLoadFixture();
  const firstCapture = fixture.captures[0]!;
  const fifthCapture = fixture.captures[4]!;
  const sixthCapture = fixture.captures[5]!;

  assert.deepEqual(
    firstCapture.expected.aiFieldNames,
    EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
  );
  assert.equal(firstCapture.jobs.aiEnrichment.jobType, "ai_enrichment");
  assert.equal(firstCapture.jobs.connectionAnalysis.jobType, "connection_analysis");
  assert.equal(firstCapture.jobs.connectionAnalysis.maxConnections, DEFAULT_EXPECTED_ENRICHMENT_CONNECTION_LIMIT);
  assert.equal(firstCapture.expected.connectionCandidateCount, 0);
  assert.deepEqual(firstCapture.expected.connectionCandidateIds, []);
  assert.equal(firstCapture.expected.triggersClusterRebuild, false);
  assert.equal(firstCapture.jobs.clusterRebuild, undefined);
  assert.equal(firstCapture.request.sourceMeta?.expectedLoad, true);
  assert.equal(firstCapture.request.sourceMeta?.userId, fixture.options.userId);

  assert.equal(fifthCapture.expected.triggersClusterRebuild, true);
  assert.equal(fifthCapture.expected.clusterRebuildOrdinal, 1);
  assert.deepEqual(fifthCapture.jobs.clusterRebuild, {
    jobType: "cluster_rebuild",
    triggerInspirationId: fifthCapture.id,
    userId: fixture.options.userId,
  });

  assert.equal(sixthCapture.semanticGroup.key, firstCapture.semanticGroup.key);
  assert.deepEqual(sixthCapture.expected.connectionCandidateIds, [firstCapture.id]);
  assert.equal(sixthCapture.expected.connectionCandidateCount, 1);
  assert.equal(
    sixthCapture.expected.expectedFinalSemanticGroupSize,
    DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME /
      DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS.length,
  );
});

test("createExpectedEnrichmentLoadFixture records per-item capture, ingest, and AI completion timestamps", () => {
  const fixture = createExpectedEnrichmentLoadFixture();
  const firstCapture = fixture.captures[0]!;
  const sixthCapture = fixture.captures[5]!;

  assert.equal(firstCapture.timestamps.captureStartedAt, firstCapture.capturedAt);
  assert.equal(
    firstCapture.timestamps.ingestStartedAt,
    "2026-04-10T00:00:01.000Z",
  );
  assert.equal(
    firstCapture.timestamps.aiFieldsCompletedAt,
    "2026-04-10T00:00:02.000Z",
  );
  assert.equal(
    new Date(firstCapture.timestamps.ingestStartedAt).getTime() -
      new Date(firstCapture.timestamps.captureStartedAt).getTime(),
    DEFAULT_EXPECTED_ENRICHMENT_INGEST_START_DELAY_MS,
  );
  assert.equal(
    new Date(firstCapture.timestamps.aiFieldsCompletedAt).getTime() -
      new Date(firstCapture.timestamps.captureStartedAt).getTime(),
    DEFAULT_EXPECTED_ENRICHMENT_AI_FIELDS_COMPLETION_DELAY_MS,
  );
  assert.equal(
    sixthCapture.timestamps.captureStartedAt,
    "2026-04-10T00:05:00.000Z",
  );
  assert.equal(
    sixthCapture.timestamps.ingestStartedAt,
    "2026-04-10T00:05:01.000Z",
  );
  assert.equal(
    sixthCapture.timestamps.aiFieldsCompletedAt,
    "2026-04-10T00:05:02.000Z",
  );
});

test("createExpectedEnrichmentLoadFixture accepts custom volume, trigger cadence, source mix, and semantic groups", () => {
  const fixture = createExpectedEnrichmentLoadFixture({
    captureVolume: 12,
    clusterMinSamples: 2,
    clusterTriggerEvery: 4,
    connectionLimit: 2,
    semanticGroups: [
      {
        key: "alpha",
        keywords: ["alpha", "queue"],
        label: "Alpha",
        summary: "Alpha captures",
      },
      {
        key: "beta",
        keywords: ["beta", "queue"],
        label: "Beta",
        summary: "Beta captures",
      },
      {
        key: "gamma",
        keywords: ["gamma", "queue"],
        label: "Gamma",
        summary: "Gamma captures",
      },
    ],
    similarityThreshold: 0.82,
    sourceTypeSequence: ["TEXT_NOTE", "URL_IMPORT"],
    userId: "user_fixture_override",
  });

  assert.equal(fixture.captures.length, 12);
  assert.deepEqual(fixture.summary.clusterRebuildTriggerOrdinals, [4, 8, 12]);
  assert.deepEqual(fixture.summary.sourceTypeBreakdown, {
    AI_CONVERSATION: 0,
    CLI_CONVERSATION: 0,
    PHOTO: 0,
    TEXT_NOTE: 6,
    URL_IMPORT: 6,
    VOICE_NOTE: 0,
  });
  assert.equal(fixture.summary.clusterableCaptureCount, 12);
  assert.deepEqual(fixture.summary.clusterableSemanticGroupKeys.sort(), [
    "alpha",
    "beta",
    "gamma",
  ]);

  const seventhCapture = fixture.captures[6]!;
  assert.equal(seventhCapture.semanticGroup.key, "alpha");
  assert.equal(seventhCapture.sourceType, "TEXT_NOTE");
  assert.equal(seventhCapture.jobs.connectionAnalysis.userId, "user_fixture_override");
  assert.equal(seventhCapture.jobs.connectionAnalysis.similarityThreshold, 0.82);
  assert.deepEqual(seventhCapture.expected.connectionCandidateIds, [
    fixture.captures[3]!.id,
    fixture.captures[0]!.id,
  ]);
  assert.equal(seventhCapture.expected.connectionCandidateCount, 2);
});

test("createExpectedEnrichmentLoadFixture rejects invalid fixture configuration", () => {
  assert.throws(
    () =>
      createExpectedEnrichmentLoadFixture({
        captureVolume: 0,
      }),
    /captureVolume must be a positive integer/,
  );
  assert.throws(
    () =>
      createExpectedEnrichmentLoadFixture({
        semanticGroups: [
          {
            key: "dup",
            keywords: ["one"],
            label: "Dup 1",
            summary: "Duplicate 1",
          },
          {
            key: "dup",
            keywords: ["two"],
            label: "Dup 2",
            summary: "Duplicate 2",
          },
        ],
      }),
    /must be unique/,
  );
  assert.throws(
    () =>
      createExpectedEnrichmentLoadFixture({
        sourceTypeSequence: [],
      }),
    /sourceTypeSequence must contain at least one supported source type/,
  );
  assert.throws(
    () =>
      createExpectedEnrichmentLoadFixture({
        clusterMinSamples: 0,
      }),
    /clusterMinSamples must be a positive integer/,
  );
  assert.throws(
    () =>
      createExpectedEnrichmentLoadFixture({
        similarityThreshold: 1.2,
      }),
    /similarityThreshold must be a finite number between 0 and 1/,
  );
});

test("the default workload exceeds the Loop 7 DBSCAN minimum sample threshold for every semantic group", () => {
  const fixture = createExpectedEnrichmentLoadFixture();

  assert.equal(
    fixture.summary.clusterableSemanticGroupKeys.length,
    DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS.length,
  );

  for (const key of fixture.summary.clusterableSemanticGroupKeys) {
    assert.equal(
      fixture.summary.semanticGroupBreakdown[key] >=
        DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_MIN_SAMPLES,
      true,
    );
  }
});
