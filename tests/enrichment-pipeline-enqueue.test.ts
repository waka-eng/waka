import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInspirationEnrichmentFieldMetadata,
  buildPendingInspirationEnrichmentFields,
  createInspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
} from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR,
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INITIAL_INSPIRATION_ENRICHMENT_STATUS,
  buildMarkInspirationEnrichmentEnqueuedArgs,
  buildMarkSelectedInspirationEnrichmentEnqueuedArgs,
  enqueueInspirationEnrichmentJob,
  enqueueSelectedInspirationEnrichmentJob,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import type { MarkInspirationEnrichmentEnqueuedPersistenceArgs } from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import type { AiEnrichmentSqsJobPayload } from "../packages/shared/types.ts";

test("buildMarkInspirationEnrichmentEnqueuedArgs resets enrichment tracking to the initial queued state", () => {
  const enqueuedAt = new Date("2026-04-10T03:15:00.000Z");

  assert.deepEqual(
    buildMarkInspirationEnrichmentEnqueuedArgs(
      "user-pipeline",
      "insp-pipeline",
      enqueuedAt,
    ),
    {
      data: {
        enrichmentAttemptCount: 0,
        enrichmentCompletedAt: null,
        enrichmentEnqueuedAt: enqueuedAt,
        enrichmentFields: buildPendingInspirationEnrichmentFields(
          INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        ),
        enrichmentFailedAt: null,
        enrichmentLastError: null,
        enrichmentLastFailureReason: null,
        enrichmentLastFailureRetryability: null,
        enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        enrichmentResumeState: null,
        enrichmentStartedAt: null,
        enrichmentStatus: INITIAL_INSPIRATION_ENRICHMENT_STATUS,
      },
      select: {
        id: true,
      },
      where: {
        userId_id: {
          id: "insp-pipeline",
          userId: "user-pipeline",
        },
      },
    },
  );
});

test("enqueueInspirationEnrichmentJob refreshes pipeline metadata after successfully publishing the queue job", async () => {
  const events: string[] = [];
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];
  const updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[] = [];
  const enqueuedAt = new Date("2026-04-10T03:20:00.000Z");

  await enqueueInspirationEnrichmentJob(
    {
      inspirationId: "insp-pipeline",
      userId: "user-pipeline",
    },
    {
      now: () => enqueuedAt,
      pipelinePersistence: {
        inspiration: {
          async update(args) {
            events.push("pipeline:update");
            updateCalls.push(args);

            return {
              id: args.where.userId_id.id,
            };
          },
        },
      },
      queuePublisher: {
        async enqueue(payload) {
          events.push("queue:enqueue");
          enqueuedPayloads.push(payload);
        },
      },
    },
  );

  assert.deepEqual(events, ["queue:enqueue", "pipeline:update"]);
  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp-pipeline",
    },
  ]);
  assert.deepEqual(updateCalls, [
    buildMarkInspirationEnrichmentEnqueuedArgs(
      "user-pipeline",
      "insp-pipeline",
      enqueuedAt,
    ),
  ]);
});

test("enqueueInspirationEnrichmentJob leaves pipeline metadata untouched when publishing the queue job fails", async () => {
  const updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[] = [];

  await assert.rejects(
    async () =>
      enqueueInspirationEnrichmentJob(
        {
          inspirationId: "insp-pipeline",
          userId: "user-pipeline",
        },
        {
          pipelinePersistence: {
            inspiration: {
              async update(args) {
                updateCalls.push(args);

                return {
                  id: args.where.userId_id.id,
                };
              },
            },
          },
          queuePublisher: {
            async enqueue() {
              throw new Error("SQS unavailable");
            },
          },
        },
      ),
    /SQS unavailable/,
  );

  assert.deepEqual(updateCalls, []);
});

test("buildMarkSelectedInspirationEnrichmentEnqueuedArgs preserves completed and untouched failed fields while queueing only the selected incomplete subset", () => {
  const completedAt = new Date("2026-04-10T04:00:00.000Z");
  const failedAt = new Date("2026-04-10T04:05:00.000Z");
  const enqueuedAt = new Date("2026-04-10T04:10:00.000Z");
  const inspiration = {
    enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
      if (fieldName === "title") {
        return buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          completedAt,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          startedAt: completedAt,
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: 1,
        failedAt,
        lastFailureReason: `Previous ${fieldName} failure.`,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt: failedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
      });
    }),
    id: "insp-rerun",
    rawContent: "Retry only the summary and keep the rest untouched.",
    title: "Recovered title",
  };

  const args = buildMarkSelectedInspirationEnrichmentEnqueuedArgs(
    "user-rerun",
    "insp-rerun",
    inspiration,
    enqueuedAt,
    ["summary"],
  );

  assert.equal(
    args.data.enrichmentFields.title.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
  assert.equal(args.data.enrichmentFields.summary.status, "PENDING");
  assert.equal(args.data.enrichmentFields.embedding.status, "FAILED");
  assert.equal(args.data.enrichmentFields.summary.lastError, null);
  assert.equal(args.data.enrichmentFields.embedding.failedAt, failedAt.toISOString());
  assert.deepEqual(args.data.enrichmentResumeState.remainingFieldNames, [
    "embedding",
    "summary",
    "tags",
    "domain",
    "mood",
    "actionability",
  ]);
});

test("enqueueSelectedInspirationEnrichmentJob publishes only the selected incomplete fields before refreshing pipeline metadata", async () => {
  const events: string[] = [];
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];
  const updateCalls: unknown[] = [];
  const enqueuedAt = new Date("2026-04-10T04:20:00.000Z");

  const result = await enqueueSelectedInspirationEnrichmentJob(
    {
      fieldNames: ["summary", "title"],
      inspirationId: "insp-selected-rerun",
      userId: "user-rerun",
    },
    {
      now: () => enqueuedAt,
      pipelinePersistence: {
        inspiration: {
          async findFirst() {
            return {
              enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
                if (fieldName === "title") {
                  return buildInspirationEnrichmentFieldMetadata({
                    attemptCount: 1,
                    completedAt: new Date("2026-04-10T04:00:00.000Z"),
                    maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
                    startedAt: new Date("2026-04-10T04:00:00.000Z"),
                    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
                  });
                }

                return buildInspirationEnrichmentFieldMetadata({
                  attemptCount: 1,
                  failedAt: new Date("2026-04-10T04:05:00.000Z"),
                  maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
                  startedAt: new Date("2026-04-10T04:05:00.000Z"),
                  status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
                });
              }),
              id: "insp-selected-rerun",
              rawContent: "Retry the summary only.",
              title: "Recovered title",
            };
          },
          async update(args) {
            events.push("pipeline:update");
            updateCalls.push(args);

            return {
              id: "insp-selected-rerun",
            };
          },
        },
      },
      queuePublisher: {
        async enqueue(payload) {
          events.push("queue:enqueue");
          enqueuedPayloads.push(payload);
        },
      },
    },
  );

  assert.deepEqual(events, ["queue:enqueue", "pipeline:update"]);
  assert.deepEqual(enqueuedPayloads, [
    {
      fieldNames: ["summary"],
      jobType: "ai_enrichment",
      inspirationId: "insp-selected-rerun",
    },
  ]);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(result, {
    queuedFieldNames: ["summary"],
    remainingFieldNames: [
      "embedding",
      "summary",
      "tags",
      "domain",
      "mood",
      "actionability",
    ],
  });
});

test("enqueueSelectedInspirationEnrichmentJob rejects requests that do not include any incomplete fields", async () => {
  await assert.rejects(
    async () =>
      enqueueSelectedInspirationEnrichmentJob(
        {
          fieldNames: ["title"],
          inspirationId: "insp-complete",
          userId: "user-rerun",
        },
        {
          pipelinePersistence: {
            inspiration: {
              async findFirst() {
                return {
                  enrichmentFields: createInspirationEnrichmentFields(() =>
                    buildInspirationEnrichmentFieldMetadata({
                      attemptCount: 1,
                      completedAt: new Date("2026-04-10T04:00:00.000Z"),
                      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
                      startedAt: new Date("2026-04-10T04:00:00.000Z"),
                      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
                    }),
                  ),
                  id: "insp-complete",
                  rawContent: "Nothing left to rerun.",
                  title: "Already done",
                };
              },
              async update() {
                throw new Error("should not update");
              },
            },
          },
          queuePublisher: {
            async enqueue() {
              throw new Error("should not enqueue");
            },
          },
        },
      ),
    new TypeError(ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR),
  );
});
