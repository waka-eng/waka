import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  buildInspirationEnrichmentFieldMetadata,
  createInspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
} from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR,
  type MarkSelectiveInspirationEnrichmentEnqueuedPersistenceArgs,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import {
  RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR,
  RERUN_INSPIRATION_ROUTE_ACCEPTED_STATUS,
  RERUN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
  RERUN_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  RERUN_INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
  handleRerunInspirationRouteRequest,
  parseRerunInspirationRequestBody,
  type RerunInspirationBackgroundScheduler,
  type RerunInspirationRouteDependencies,
} from "../apps/web/src/inspirations/rerun-route.ts";
import type { AiEnrichmentSqsJobPayload } from "../packages/shared/types.ts";

interface StubRerunnableInspirationRecord {
  enrichmentFields?: ReturnType<typeof createInspirationEnrichmentFields>;
  id: string;
  rawContent: string;
  title?: string | null;
  userId: string;
}

function createAsyncTaskHarness(): {
  flushScheduledTasks(): Promise<void>;
  schedule: RerunInspirationBackgroundScheduler;
} {
  const tasks: Array<() => Promise<void>> = [];

  return {
    async flushScheduledTasks() {
      while (tasks.length > 0) {
        const task = tasks.shift();

        if (task) {
          await task();
        }
      }
    },
    schedule(task) {
      tasks.push(task);
    },
  };
}

function createRerunDependencies(
  inspirations: StubRerunnableInspirationRecord[],
): {
  dependencies: RerunInspirationRouteDependencies;
  enqueuePayloads: AiEnrichmentSqsJobPayload[];
  findFirstCalls: Array<{
    where: {
      deletedAt: null;
      id: string;
      userId: string;
    };
  }>;
  updateCalls: MarkSelectiveInspirationEnrichmentEnqueuedPersistenceArgs[];
} {
  const enqueuePayloads: AiEnrichmentSqsJobPayload[] = [];
  const findFirstCalls: Array<{
    where: {
      deletedAt: null;
      id: string;
      userId: string;
    };
  }> = [];
  const updateCalls: MarkSelectiveInspirationEnrichmentEnqueuedPersistenceArgs[] =
    [];

  return {
    dependencies: {
      auth: {
        async resolveAuthenticatedUserId() {
          return "user-42";
        },
      },
      enrichmentPipeline: {
        inspiration: {
          async findFirst(args) {
            findFirstCalls.push(args);

            const inspiration = inspirations.find((candidate) => {
              return (
                candidate.id === args.where.id &&
                candidate.userId === args.where.userId
              );
            });

            if (!inspiration) {
              return null;
            }

            return {
              enrichmentFields: inspiration.enrichmentFields,
              id: inspiration.id,
              rawContent: inspiration.rawContent,
              title: inspiration.title,
            };
          },
          async update(args) {
            updateCalls.push(args);

            return {
              id: args.where.userId_id.id,
            };
          },
        },
      },
      queuePublisher: {
        async enqueue(payload) {
          enqueuePayloads.push(payload);
        },
      },
    },
    enqueuePayloads,
    findFirstCalls,
    updateCalls,
  };
}

test("parseRerunInspirationRequestBody accepts an optional field selection and strips ownership fields", async () => {
  const parsedBody = await parseRerunInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/insp-1/rerun", {
      method: "POST",
      body: JSON.stringify({
        fieldNames: ["summary", "summary"],
        ownerId: "forged-owner",
        userId: "forged-user",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedBody, {
    fieldNames: ["summary"],
  });
});

test("parseRerunInspirationRequestBody rejects invalid field names", async () => {
  await assert.rejects(
    async () =>
      parseRerunInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-1/rerun", {
          method: "POST",
          body: JSON.stringify({
            fieldNames: ["not-a-field"],
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR),
  );
});

test("handleRerunInspirationRouteRequest returns 401 when the caller is not authenticated", async () => {
  const { dependencies, enqueuePayloads, findFirstCalls, updateCalls } =
    createRerunDependencies([]);

  const response = await handleRerunInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-1/rerun", {
      method: "POST",
      body: JSON.stringify({
        fieldNames: ["summary"],
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        ...dependencies,
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
      },
      params: {
        inspirationId: "insp-1",
      },
    },
  );

  assert.equal(response.status, RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(findFirstCalls.length, 0);
  assert.equal(updateCalls.length, 0);
  assert.deepEqual(enqueuePayloads, []);
});

test("handleRerunInspirationRouteRequest filters selected fields down to incomplete ones and defers queue work off the response path", async () => {
  const asyncTasks = createAsyncTaskHarness();
  const { dependencies, enqueuePayloads, findFirstCalls, updateCalls } =
    createRerunDependencies([
      {
        enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
          if (fieldName === "title") {
            return buildInspirationEnrichmentFieldMetadata({
              attemptCount: 1,
              completedAt: new Date("2026-04-10T05:00:00.000Z"),
              maxAttemptCount: 3,
              startedAt: new Date("2026-04-10T05:00:00.000Z"),
              status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
            });
          }

          return buildInspirationEnrichmentFieldMetadata({
            attemptCount: 1,
            failedAt: new Date("2026-04-10T05:05:00.000Z"),
            lastFailureReason: `Previous ${fieldName} failure.`,
            maxAttemptCount: 3,
            startedAt: new Date("2026-04-10T05:05:00.000Z"),
            status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
          });
        }),
        id: "insp-rerun",
        rawContent: "Retry only the summary without disturbing the other failed fields.",
        title: "Recovered title",
        userId: "user-42",
      },
    ]);

  const startedAt = performance.now();
  const response = await handleRerunInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-rerun/rerun", {
      method: "POST",
      body: JSON.stringify({
        fieldNames: ["summary", "title"],
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        ...dependencies,
        backgroundScheduler: asyncTasks.schedule,
        queuePublisher: {
          async enqueue(payload) {
            await new Promise((resolve) => {
              setTimeout(resolve, 750);
            });
            enqueuePayloads.push(payload);
          },
        },
      },
      params: {
        inspirationId: "insp-rerun",
      },
    },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, RERUN_INSPIRATION_ROUTE_ACCEPTED_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-rerun",
    queuedFieldNames: ["summary"],
  });
  assert.ok(
    elapsedMs < 500,
    `expected the response path to stay under 500ms, got ${elapsedMs.toFixed(2)}ms`,
  );
  assert.deepEqual(findFirstCalls[0]?.where, {
    deletedAt: null,
    id: "insp-rerun",
    userId: "user-42",
  });
  assert.deepEqual(enqueuePayloads, []);
  assert.equal(updateCalls.length, 0);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuePayloads, [
    {
      fieldNames: ["summary"],
      jobType: "ai_enrichment",
      inspirationId: "insp-rerun",
    },
  ]);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.enrichmentFields.summary.status, "PENDING");
  assert.equal(updateCalls[0]?.data.enrichmentFields.embedding.status, "FAILED");
  assert.equal(updateCalls[0]?.data.enrichmentFields.title.status, "COMPLETED");
});

test("handleRerunInspirationRouteRequest returns the shared not-found contract when the inspiration is missing or owned by another user", async () => {
  const { dependencies } = createRerunDependencies([
    {
      id: "insp-secret",
      rawContent: "Should not be rerunnable by another user.",
      userId: "user-other",
    },
  ]);

  const response = await handleRerunInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-secret/rerun", {
      method: "POST",
      body: JSON.stringify({
        fieldNames: ["summary"],
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
      params: {
        inspirationId: "insp-secret",
      },
    },
  );

  assert.equal(response.status, RERUN_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: RERUN_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
});

test("handleRerunInspirationRouteRequest rejects selections that do not target any incomplete fields", async () => {
  const { dependencies } = createRerunDependencies([
    {
      enrichmentFields: createInspirationEnrichmentFields(() =>
        buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          completedAt: new Date("2026-04-10T05:00:00.000Z"),
          maxAttemptCount: 3,
          startedAt: new Date("2026-04-10T05:00:00.000Z"),
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
        }),
      ),
      id: "insp-complete",
      rawContent: "Everything is already done.",
      title: "Complete",
      userId: "user-42",
    },
  ]);

  const response = await handleRerunInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-complete/rerun", {
      method: "POST",
      body: JSON.stringify({
        fieldNames: ["title"],
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
      params: {
        inspirationId: "insp-complete",
      },
    },
  );

  assert.equal(response.status, RERUN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR,
  });
});
