import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildPendingInspirationEnrichmentFields } from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  DEEPEN_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR,
  DEEPEN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
  DEEPEN_INSPIRATION_ROUTE_CREATED_STATUS,
  DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
  buildDeepenInspirationPersistenceArgs,
  buildReadParentInspirationPersistenceArgs,
  configureDeepenInspirationRouteDependencies,
  handleDeepenInspirationRouteRequest,
  parseDeepenInspirationRequestBody,
  type DeepenInspirationPersistenceClient,
  type ParentInspirationRecord,
} from "../apps/web/src/inspirations/deepen-route.ts";
import type { SupportedSqsJobPayload } from "../packages/shared/types.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  buildInitialInspirationEnrichmentPersistenceData,
  type MarkInspirationEnrichmentEnqueuedPersistenceArgs,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import {
  buildCreateInspirationProcessingState,
  type CreateInspirationBackgroundScheduler,
} from "../apps/web/src/inspirations/create-route.ts";

interface StubParentInspirationRecord extends ParentInspirationRecord {
  userId: string;
}

function createPersistenceClient(
  parentInspirations: StubParentInspirationRecord[],
): {
  client: DeepenInspirationPersistenceClient;
  createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }>;
  findFirstCalls: Array<{
    select: {
      clusterId: true;
      id: true;
      sourceParentId: true;
    };
    where: {
      deletedAt: null;
      id: string;
      userId: string;
    };
  }>;
} {
  const createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }> = [];
  const findFirstCalls: Array<{
    select: {
      clusterId: true;
      id: true;
      sourceParentId: true;
    };
    where: {
      deletedAt: null;
      id: string;
      userId: string;
    };
  }> = [];

  return {
    client: {
      inspiration: {
        async create(args) {
          createCalls.push(args as typeof createCalls[number]);

          return {
            id: "insp_child",
            rawContent: String(args.data.rawContent),
            sourceType: "TEXT_NOTE",
          };
        },
        async findFirst(args) {
          findFirstCalls.push(args as typeof findFirstCalls[number]);

          const parentInspiration = parentInspirations.find((candidate) => {
            return (
              candidate.id === args.where.id &&
              candidate.userId === args.where.userId
            );
          });

          if (!parentInspiration) {
            return null;
          }

          return {
            id: parentInspiration.id,
            clusterId: parentInspiration.clusterId,
            sourceParentId: parentInspiration.sourceParentId,
          };
        },
      },
    },
    createCalls,
    findFirstCalls,
  };
}

function createAsyncTaskHarness(): {
  flushScheduledTasks(): Promise<void>;
  schedule: CreateInspirationBackgroundScheduler;
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

function createEnrichmentPipelineClient(): {
  client: {
    inspiration: {
      update(
        args: MarkInspirationEnrichmentEnqueuedPersistenceArgs,
      ): Promise<{
        id: string;
      }>;
    };
  };
  updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[];
} {
  const updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[] = [];

  return {
    client: {
      inspiration: {
        async update(args) {
          updateCalls.push(args);

          return {
            id: args.where.userId_id.id,
          };
        },
      },
    },
    updateCalls,
  };
}

test("buildReadParentInspirationPersistenceArgs scopes the parent lookup to the authenticated user", () => {
  assert.deepEqual(
    buildReadParentInspirationPersistenceArgs("user-1", "parent-1"),
    {
      where: {
        id: "parent-1",
        userId: "user-1",
        deletedAt: null,
      },
      select: {
        id: true,
        clusterId: true,
        sourceParentId: true,
      },
    },
  );
});

test("buildDeepenInspirationPersistenceArgs links the child to the selected parent and inherits the cluster", () => {
  assert.deepEqual(
    buildDeepenInspirationPersistenceArgs(
      "user-1",
      {
        id: "parent-1",
        clusterId: "cluster-1",
      },
      {
        rawContent: "Derived deepen content",
      },
    ),
    {
      data: {
        userId: "user-1",
        originalRawContent: "Derived deepen content",
        rawContent: "Derived deepen content",
        sourceType: "TEXT_NOTE",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        parentId: "parent-1",
        sourceParentId: "parent-1",
        clusterId: "cluster-1",
      },
      select: {
        id: true,
        rawContent: true,
        sourceType: true,
      },
    },
  );
});

test("buildDeepenInspirationPersistenceArgs preserves the originating parent id when deepening an existing child", () => {
  assert.deepEqual(
    buildDeepenInspirationPersistenceArgs(
      "user-1",
      {
        id: "child-1",
        clusterId: "cluster-1",
        sourceParentId: "root-1",
      },
      {
        rawContent: "Deeper context",
      },
    ),
    {
      data: {
        userId: "user-1",
        originalRawContent: "Deeper context",
        rawContent: "Deeper context",
        sourceType: "TEXT_NOTE",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        parentId: "child-1",
        sourceParentId: "root-1",
        clusterId: "cluster-1",
      },
      select: {
        id: true,
        rawContent: true,
        sourceType: true,
      },
    },
  );
});

test("parseDeepenInspirationRequestBody accepts a single-character child payload and strips client-controlled link fields", async () => {
  const parsedRequestBody = await parseDeepenInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/parent-1/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "x",
        ownerId: "forged-owner",
        userId: "forged-user",
        tenantId: "forged-tenant",
        workspaceId: "forged-workspace",
        parentId: "forged-parent",
        sourceParentId: "forged-source-parent",
        clusterId: "forged-cluster",
        sourceType: "PHOTO",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent: "x",
  });
  assert.equal("ownerId" in parsedRequestBody, false);
  assert.equal("userId" in parsedRequestBody, false);
  assert.equal("tenantId" in parsedRequestBody, false);
  assert.equal("workspaceId" in parsedRequestBody, false);
  assert.equal("parentId" in parsedRequestBody, false);
  assert.equal("sourceParentId" in parsedRequestBody, false);
  assert.equal("clusterId" in parsedRequestBody, false);
  assert.equal("sourceType" in parsedRequestBody, false);
});

test("handleDeepenInspirationRouteRequest returns 401 when the caller is not authenticated", async () => {
  const { client, createCalls, findFirstCalls } = createPersistenceClient([
    {
      id: "parent-1",
      userId: "user-1",
      clusterId: "cluster-1",
    },
  ]);
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];

  const response = await handleDeepenInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/parent-1/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Add more context later.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: {
        inspirationId: "parent-1",
      },
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
      },
    },
  );

  assert.equal(response.status, DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(findFirstCalls.length, 0);
  assert.equal(createCalls.length, 0);
  assert.equal(enqueuedPayloads.length, 0);
});

test("handleDeepenInspirationRouteRequest creates a linked child from the selected parent and defers ai enrichment off the response path", async () => {
  const { client, createCalls, findFirstCalls } = createPersistenceClient([
    {
      id: "parent-1",
      userId: "user-42",
      clusterId: "cluster-1",
    },
  ]);
  const { client: enrichmentPipeline, updateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  const startedAt = performance.now();
  const response = await handleDeepenInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/parent-1/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Derived deepen content from the detail view.",
        parentId: "forged-parent",
        clusterId: "forged-cluster",
        sourceType: "AI_CONVERSATION",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: {
        inspirationId: "parent-1",
      },
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        backgroundScheduler: asyncTasks.schedule,
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            await new Promise((resolve) => {
              setTimeout(resolve, 750);
            });
            enqueuedPayloads.push(payload);
          },
        },
      },
    },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, DEEPEN_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    childId: "insp_child",
    id: "insp_child",
    processingState: buildCreateInspirationProcessingState(),
    rawContent: "Derived deepen content from the detail view.",
    sourceType: "TEXT_NOTE",
    sourceParentId: "parent-1",
  });
  assert.ok(
    elapsedMs < 500,
    `expected the response path to stay under 500ms, got ${elapsedMs.toFixed(2)}ms`,
  );
  assert.deepEqual(findFirstCalls[0]?.where, {
    id: "parent-1",
    userId: "user-42",
    deletedAt: null,
  });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    data: {
      userId: "user-42",
      originalRawContent: "Derived deepen content from the detail view.",
      rawContent: "Derived deepen content from the detail view.",
      sourceType: "TEXT_NOTE",
      tags: [],
      ...buildInitialInspirationEnrichmentPersistenceData(),
      parentId: "parent-1",
      sourceParentId: "parent-1",
      clusterId: "cluster-1",
    },
    select: {
      id: true,
      rawContent: true,
      sourceType: true,
    },
  });
  assert.deepEqual(enqueuedPayloads, []);
  assert.equal(updateCalls.length, 0);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_child",
    },
    {
      jobType: "reflection_reembedding",
      inspirationId: "parent-1",
    },
  ]);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.where.userId_id.userId, "user-42");
  assert.equal(updateCalls[0]?.where.userId_id.id, "insp_child");
  assert.equal(updateCalls[0]?.data.enrichmentStatus, "PENDING");
  assert.equal(updateCalls[0]?.data.enrichmentAttemptCount, 0);
  assert.equal(
    updateCalls[0]?.data.enrichmentMaxAttemptCount,
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  assert.deepEqual(
    updateCalls[0]?.data.enrichmentFields,
    buildPendingInspirationEnrichmentFields(
      INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    ),
  );
});

test("handleDeepenInspirationRouteRequest returns the rooted source parent id when deepening an existing child", async () => {
  const { client } = createPersistenceClient([
    {
      id: "child-1",
      userId: "user-42",
      clusterId: "cluster-1",
      sourceParentId: "root-1",
    },
  ]);
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  const response = await handleDeepenInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/child-1/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Go one level deeper.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: {
        inspirationId: "child-1",
      },
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        backgroundScheduler: asyncTasks.schedule,
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
      },
    },
  );

  assert.equal(response.status, DEEPEN_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    childId: "insp_child",
    id: "insp_child",
    processingState: buildCreateInspirationProcessingState(),
    rawContent: "Go one level deeper.",
    sourceType: "TEXT_NOTE",
    sourceParentId: "root-1",
  });

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_child",
    },
    {
      jobType: "reflection_reembedding",
      inspirationId: "root-1",
    },
  ]);
});

test("handleDeepenInspirationRouteRequest returns the shared not-found contract when the selected parent is missing or belongs to another user", async () => {
  const crossUserPersistence = createPersistenceClient([
    {
      id: "parent-secret",
      userId: "user-other",
      clusterId: "cluster-secret",
    },
  ]);
  const missingPersistence = createPersistenceClient([]);
  const { client: crossUserEnrichmentPipeline } =
    createEnrichmentPipelineClient();
  const { client: missingEnrichmentPipeline } =
    createEnrichmentPipelineClient();
  const crossUserEnqueuedPayloads: SupportedSqsJobPayload[] = [];
  const missingEnqueuedPayloads: SupportedSqsJobPayload[] = [];

  const crossUserResponse = await handleDeepenInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/parent-secret/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Should never be able to deepen another user's capture.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: {
        inspirationId: "parent-secret",
      },
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline: crossUserEnrichmentPipeline,
        persistence: crossUserPersistence.client,
        queuePublisher: {
          async enqueue(payload) {
            crossUserEnqueuedPayloads.push(payload);
          },
        },
      },
    },
  );

  const missingResponse = await handleDeepenInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/parent-missing/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Missing parents should look the same as cross-user ones.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: {
        inspirationId: "parent-missing",
      },
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline: missingEnrichmentPipeline,
        persistence: missingPersistence.client,
        queuePublisher: {
          async enqueue(payload) {
            missingEnqueuedPayloads.push(payload);
          },
        },
      },
    },
  );

  assert.equal(crossUserResponse.status, DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.equal(missingResponse.status, DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await crossUserResponse.json(), {
    error: DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.deepEqual(await missingResponse.json(), {
    error: DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(crossUserPersistence.createCalls.length, 0);
  assert.equal(missingPersistence.createCalls.length, 0);
  assert.deepEqual(crossUserEnqueuedPayloads, []);
  assert.deepEqual(missingEnqueuedPayloads, []);
});

test("app/api/inspirations/[id]/deepen/route.ts ignores spoofed link fields on POST and creates the child under the authenticated parent", async () => {
  const { client, createCalls, findFirstCalls } = createPersistenceClient([
    {
      id: "parent-route",
      userId: "user-route",
      clusterId: "cluster-route",
    },
  ]);
  const { client: enrichmentPipeline, updateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  configureDeepenInspirationRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    backgroundScheduler: asyncTasks.schedule,
    enrichmentPipeline,
    persistence: client,
    queuePublisher: {
      async enqueue(payload) {
        enqueuedPayloads.push(payload);
      },
    },
  });

  try {
    const { POST } = await import(
      "../apps/web/app/api/inspirations/[id]/deepen/route.ts"
    );
    const response = await POST(
      new Request("https://waka.app/api/inspirations/parent-route/deepen", {
        method: "POST",
        body: JSON.stringify({
          rawContent: "Route handler delegation stays thin for deepen.",
          ownerId: "forged-owner",
          userId: "forged-user",
          tenantId: "forged-tenant",
          workspaceId: "forged-workspace",
          parentId: "forged-parent",
          sourceParentId: "forged-source-parent",
          clusterId: "forged-cluster",
          sourceType: "PHOTO",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
      {
        params: Promise.resolve({
          id: "parent-route",
        }),
      },
    );

    assert.equal(response.status, DEEPEN_INSPIRATION_ROUTE_CREATED_STATUS);
    assert.deepEqual(await response.json(), {
      childId: "insp_child",
      id: "insp_child",
      processingState: buildCreateInspirationProcessingState(),
      rawContent: "Route handler delegation stays thin for deepen.",
      sourceType: "TEXT_NOTE",
      sourceParentId: "parent-route",
    });

    await asyncTasks.flushScheduledTasks();

    assert.deepEqual(findFirstCalls[0]?.where, {
      id: "parent-route",
      userId: "user-route",
      deletedAt: null,
    });
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0]?.data.userId, "user-route");
    assert.equal(createCalls[0]?.data.parentId, "parent-route");
    assert.equal(createCalls[0]?.data.sourceParentId, "parent-route");
    assert.equal(createCalls[0]?.data.clusterId, "cluster-route");
    assert.equal(createCalls[0]?.data.sourceType, "TEXT_NOTE");
    assert.equal("ownerId" in (createCalls[0]?.data ?? {}), false);
    assert.equal("userId" in (createCalls[0]?.data ?? {}), true);
    assert.equal("tenantId" in (createCalls[0]?.data ?? {}), false);
    assert.equal("workspaceId" in (createCalls[0]?.data ?? {}), false);
    assert.deepEqual(enqueuedPayloads, [
      {
        jobType: "ai_enrichment",
        inspirationId: "insp_child",
      },
      {
        jobType: "reflection_reembedding",
        inspirationId: "parent-route",
      },
    ]);
    assert.equal(updateCalls.length, 1);
  } finally {
    configureDeepenInspirationRouteDependencies(null);
  }
});

test("handleDeepenInspirationRouteRequest returns 400 for invalid deepen payloads", async () => {
  const { client, createCalls, findFirstCalls } = createPersistenceClient([
    {
      id: "parent-1",
      userId: "user-1",
      clusterId: "cluster-1",
    },
  ]);
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleDeepenInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/parent-1/deepen", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: {
        inspirationId: "parent-1",
      },
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-1";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
    },
  );

  assert.equal(response.status, DEEPEN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: DEEPEN_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR,
  });
  assert.equal(findFirstCalls.length, 0);
  assert.equal(createCalls.length, 0);
});
