import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  buildCreateClusterReassignmentDiscoveryEventArgs,
  buildFindDiscoveryEventInspirationClusterArgs,
  type CreateClusterReassignmentDiscoveryEventArgs,
  type FindDiscoveryEventInspirationClusterArgs,
} from "../apps/web/src/discoveries/cluster-reassignment-persistence.ts";
import {
  buildInspirationEnrichmentFieldMetadata,
  buildPendingInspirationEnrichmentFields,
  createInspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
} from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  UPDATE_INSPIRATION_IS_PUBLIC_INVALID_ERROR,
  UPDATE_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  UPDATE_INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  UPDATE_INSPIRATION_REFLECTION_ANSWER_INVALID_ERROR,
  UPDATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR,
  UPDATE_INSPIRATION_REQUEST_BODY_EMPTY_ERROR,
  UPDATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR,
  UPDATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
  UPDATE_INSPIRATION_ROUTE_OK_STATUS,
  UPDATE_INSPIRATION_TAGS_INVALID_ERROR,
  UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
  UpdateInspirationNotFoundError,
  buildUpdateInspirationPersistenceArgs,
  configureUpdateInspirationRouteDependencies,
  generateInspirationShareSlug,
  handleUpdateInspirationRouteRequest,
  parseUpdateInspirationRequestBody,
  type UpdateInspirationBackgroundScheduler,
  type UpdateInspirationPersistenceArgs,
  type UpdateInspirationPersistenceClient,
  type UpdatedInspirationRecord,
} from "../apps/web/src/inspirations/update-route.ts";
import type { SupportedSqsJobPayload } from "../packages/shared/types.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
  type MarkInspirationEnrichmentEnqueuedPersistenceArgs,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

function createPersistenceClient(
  options: {
    currentClusterId?: string | null;
    rawContentChanged?: boolean;
  } = {},
): {
  client: UpdateInspirationPersistenceClient;
  discoveryEventCreateCalls: CreateClusterReassignmentDiscoveryEventArgs[];
  findFirstCalls: FindDiscoveryEventInspirationClusterArgs[];
  updateCalls: UpdateInspirationPersistenceArgs[];
} {
  const {
    currentClusterId = "cluster-existing",
    rawContentChanged = true,
  } = options;
  const discoveryEventCreateCalls: CreateClusterReassignmentDiscoveryEventArgs[] =
    [];
  const findFirstCalls: FindDiscoveryEventInspirationClusterArgs[] = [];
  const updateCalls: UpdateInspirationPersistenceArgs[] = [];

  return {
    client: {
      discoveryEvent: {
        async create(args) {
          discoveryEventCreateCalls.push(args);

          return {
            id: `discovery-event-${discoveryEventCreateCalls.length}`,
          };
        },
      },
      inspiration: {
        async findFirst(args) {
          findFirstCalls.push(args);

          return {
            clusterId: currentClusterId,
            id: args.where.id,
          };
        },
        async update(args) {
          updateCalls.push(args);

          return {
            ...(typeof args.data.audioStorageKey === "string" ||
            args.data.audioStorageKey === null
              ? { audioStorageKey: args.data.audioStorageKey }
              : {}),
            ...(typeof args.data.audioStorageUrl === "string" ||
            args.data.audioStorageUrl === null
              ? { audioStorageUrl: args.data.audioStorageUrl }
              : {}),
            ...(typeof args.data.audioMimeType === "string" ||
            args.data.audioMimeType === null
              ? { audioMimeType: args.data.audioMimeType }
              : {}),
            ...(typeof args.data.audioSizeBytes === "number" ||
            args.data.audioSizeBytes === null
              ? { audioSizeBytes: args.data.audioSizeBytes }
              : {}),
            ...(typeof args.data.audioDurationSeconds === "number" ||
            args.data.audioDurationSeconds === null
              ? { audioDurationSeconds: args.data.audioDurationSeconds }
              : {}),
            ...(typeof args.data.isPublic === "boolean"
              ? { isPublic: args.data.isPublic }
              : {}),
            ...(typeof args.data.shareSlug === "string" ||
            args.data.shareSlug === null
              ? { shareSlug: args.data.shareSlug }
              : {}),
            id: args.where.userId_id.id,
            rawContent:
              typeof args.data.rawContent === "string"
                ? args.data.rawContent
                : "Existing persisted capture.",
            sourceType: "TEXT_NOTE",
            rawContentChanged,
          } satisfies UpdatedInspirationRecord;
        },
      },
    },
    discoveryEventCreateCalls,
    findFirstCalls,
    updateCalls,
  };
}

function createAsyncTaskHarness(): {
  flushScheduledTasks(): Promise<void>;
  schedule: UpdateInspirationBackgroundScheduler;
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
      findFirst(): Promise<{
        actionability?: string | null;
        domain?: string | null;
        enrichmentFields?: ReturnType<typeof createInspirationEnrichmentFields>;
        enrichmentResumeState?: {
          capture: {
            mediaUrl: null;
            rawContent: string;
            sourceMeta: null;
            sourceUrl: null;
            title: string | null;
            transcript: null;
          };
          completedFieldNames: string[];
          completedOutputs: {
            title?: string;
          };
          remainingFieldNames: string[];
          updatedAt: string;
        } | null;
        id: string;
        mood?: string | null;
        rawContent: string;
        summary?: string | null;
        tags?: string[] | null;
        title?: string | null;
      } | null>;
      update(
        args: MarkInspirationEnrichmentEnqueuedPersistenceArgs,
      ): Promise<{
        id: string;
      }>;
    };
  };
  findFirstCalls: Array<unknown>;
  updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[];
} {
  const updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[] = [];
  const findFirstCalls: unknown[] = [];

  return {
    client: {
      inspiration: {
        async findFirst(args) {
          findFirstCalls.push(args);

          return {
            enrichmentFields: buildPendingInspirationEnrichmentFields(
              INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
            ),
            id: "insp-existing",
            rawContent: "Existing persisted capture.",
            title: "Existing persisted capture.",
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
    findFirstCalls,
    updateCalls,
  };
}

test("generateInspirationShareSlug returns URL-safe unique slugs", () => {
  assert.equal(
    generateInspirationShareSlug(
      () => "123e4567-e89b-12d3-a456-426614174000",
    ),
    "insp_123e4567e89b12d3a456426614174000",
  );

  const generatedSlugs = new Set(
    Array.from({ length: 32 }, () => generateInspirationShareSlug()),
  );

  assert.equal(generatedSlugs.size, 32);

  for (const generatedSlug of generatedSlugs) {
    assert.match(generatedSlug, /^insp_[A-Za-z0-9]+$/);
  }
});

test("buildUpdateInspirationPersistenceArgs scopes the update to the current user and changed fields only", () => {
  assert.deepEqual(
    buildUpdateInspirationPersistenceArgs("user-1", "insp-1", {
      actionability: "Act now",
      audioStorageKey: "users/user-1/voice-notes/insp-1.webm",
      audioStorageUrl: "https://waka.app/media/insp-1.webm",
      audioMimeType: "audio/webm",
      audioSizeBytes: 2048,
      audioDurationSeconds: 12.4,
      domain: "product",
      isPublic: true,
      summary: "Manual summary",
      tags: ["manual", "recovery"],
      mood: "urgent",
      rawContent: "Updated capture copy.",
      shareSlug: "insp_manualshare",
      title: "Sharper title",
      sourceUrl: "https://waka.app/source",
      sourceMeta: {
        provider: "manual",
      },
      mediaUrl: "https://waka.app/media.m4a",
      transcript: "Updated capture copy.",
      clusterId: "cluster-1",
    }),
    {
      data: {
        actionability: "Act now",
        audioStorageKey: "users/user-1/voice-notes/insp-1.webm",
        audioStorageUrl: "https://waka.app/media/insp-1.webm",
        audioMimeType: "audio/webm",
        audioSizeBytes: 2048,
        audioDurationSeconds: 12.4,
        rawContent: "Updated capture copy.",
        domain: "product",
        isPublic: true,
        summary: "Manual summary",
        tags: ["manual", "recovery"],
        mood: "urgent",
        shareSlug: "insp_manualshare",
        title: "Sharper title",
        sourceUrl: "https://waka.app/source",
        sourceMeta: {
          provider: "manual",
        },
        mediaUrl: "https://waka.app/media.m4a",
        transcript: "Updated capture copy.",
        clusterId: "cluster-1",
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "insp-1",
          userId: "user-1",
        },
      },
    },
  );
});

test("buildUpdateInspirationPersistenceArgs does not mutate the original capture snapshot", () => {
  const args = buildUpdateInspirationPersistenceArgs("user-1", "insp-1", {
    rawContent: "Updated capture copy.",
    title: "Sharper title",
    sourceUrl: "https://waka.app/source",
    sourceMeta: {
      provider: "manual",
    },
    mediaUrl: "https://waka.app/media.m4a",
    transcript: "Updated capture copy.",
  });

  assert.equal("originalRawContent" in args.data, false);
  assert.equal("originalTitle" in args.data, false);
  assert.equal("originalSourceUrl" in args.data, false);
  assert.equal("originalSourceMeta" in args.data, false);
  assert.equal("originalMediaUrl" in args.data, false);
  assert.equal("originalTranscript" in args.data, false);
});

test("parseUpdateInspirationRequestBody accepts AI field overrides plus a single-character rawContent update and rejects empty payloads", async () => {
  const parsedRequestBody = await parseUpdateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/insp-1", {
      method: "PUT",
      body: JSON.stringify({
        summary: "  Manual summary  ",
        tags: [" recovery ", "manual", "manual", "   "],
        rawContent: "x",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    summary: "Manual summary",
    tags: ["recovery", "manual"],
    rawContent: "x",
  });

  await assert.rejects(
    async () =>
      parseUpdateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-1", {
          method: "PUT",
          body: JSON.stringify({}),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(UPDATE_INSPIRATION_REQUEST_BODY_EMPTY_ERROR),
  );
});

test("parseUpdateInspirationRequestBody accepts nullable voice upload metadata fields", async () => {
  const parsedRequestBody = await parseUpdateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/insp-voice", {
      method: "PUT",
      body: JSON.stringify({
        audioStorageKey: "users/user-1/voice-notes/insp-voice.webm",
        audioStorageUrl: "https://waka.app/media/insp-voice.webm",
        audioMimeType: "audio/webm",
        audioSizeBytes: 2048,
        audioDurationSeconds: 12.4,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    audioStorageKey: "users/user-1/voice-notes/insp-voice.webm",
    audioStorageUrl: "https://waka.app/media/insp-voice.webm",
    audioMimeType: "audio/webm",
    audioSizeBytes: 2048,
    audioDurationSeconds: 12.4,
  });
});

test("parseUpdateInspirationRequestBody accepts public-share toggles and rejects non-boolean isPublic values", async () => {
  const parsedRequestBody = await parseUpdateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/insp-share", {
      method: "PUT",
      body: JSON.stringify({
        isPublic: true,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    isPublic: true,
  });

  await assert.rejects(
    async () =>
      parseUpdateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-share", {
          method: "PUT",
          body: JSON.stringify({
            isPublic: "true",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(UPDATE_INSPIRATION_IS_PUBLIC_INVALID_ERROR),
  );
});

test("parseUpdateInspirationRequestBody accepts a trimmed reflection answer and rejects blank answers", async () => {
  const parsedRequestBody = await parseUpdateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/insp-reflection", {
      method: "PUT",
      body: JSON.stringify({
        reflectionAnswer: "  The contrast with my earlier notes made the gap obvious.  ",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    reflectionAnswer:
      "The contrast with my earlier notes made the gap obvious.",
  });

  await assert.rejects(
    async () =>
      parseUpdateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-reflection", {
          method: "PUT",
          body: JSON.stringify({
            reflectionAnswer: "   ",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(UPDATE_INSPIRATION_REFLECTION_ANSWER_INVALID_ERROR),
  );
});

test("parseUpdateInspirationRequestBody strips client-supplied ownership fields", async () => {
  const parsedRequestBody = await parseUpdateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations/insp-1", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "Keep this update scoped to the authenticated user.",
        userId: "forged-user",
        ownerId: "forged-owner",
        tenantId: "forged-tenant",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent: "Keep this update scoped to the authenticated user.",
  });
  assert.equal("userId" in parsedRequestBody, false);
  assert.equal("ownerId" in parsedRequestBody, false);
  assert.equal("tenantId" in parsedRequestBody, false);
  assert.equal("workspaceId" in parsedRequestBody, false);
});

test("parseUpdateInspirationRequestBody rejects invalid JSON and empty rawContent updates", async () => {
  await assert.rejects(
    async () =>
      parseUpdateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-1", {
          method: "PUT",
          body: "{",
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    /Request body must be valid JSON\./,
  );

  await assert.rejects(
    async () =>
      parseUpdateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-1", {
          method: "PUT",
          body: JSON.stringify({
            rawContent: "",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(UPDATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseUpdateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations/insp-1", {
          method: "PUT",
          body: JSON.stringify({
            tags: ["valid", 42],
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(UPDATE_INSPIRATION_TAGS_INVALID_ERROR),
  );
});

test("handleUpdateInspirationRouteRequest returns 401 when the caller is not authenticated", async () => {
  const { client, updateCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-1", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "Keep drafts durable.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
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
      params: {
        inspirationId: "insp-1",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(updateCalls.length, 0);
  assert.equal(enqueuedPayloads.length, 0);
});

test("handleUpdateInspirationRouteRequest persists ownership from auth context instead of the client payload", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-owned", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "Keep this update owned by the authenticated user.",
        userId: "forged-user",
        ownerId: "forged-owner",
        tenantId: "forged-tenant",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-authenticated";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
      params: {
        inspirationId: "insp-owned",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.equal(updateCalls.length, 1);
  assert.equal(
    updateCalls[0]?.where.userId_id.userId,
    "user-authenticated",
  );
  assert.equal(updateCalls[0]?.where.userId_id.id, "insp-owned");
  assert.equal("ownerId" in (updateCalls[0]?.data ?? {}), false);
  assert.equal("userId" in (updateCalls[0]?.data ?? {}), false);
  assert.equal("tenantId" in (updateCalls[0]?.data ?? {}), false);
  assert.equal("workspaceId" in (updateCalls[0]?.data ?? {}), false);
});

test("handleUpdateInspirationRouteRequest records a cluster reassignment discovery event when a capture moves between clusters", async () => {
  const {
    client,
    discoveryEventCreateCalls,
    findFirstCalls,
  } = createPersistenceClient({
    currentClusterId: "cluster_previous",
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-reassigned", {
      method: "PUT",
      body: JSON.stringify({
        clusterId: "cluster_next",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-discovery";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
      params: {
        inspirationId: "insp-reassigned",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(findFirstCalls, [
    buildFindDiscoveryEventInspirationClusterArgs(
      "user-discovery",
      "insp-reassigned",
    ),
  ]);
  assert.deepEqual(discoveryEventCreateCalls, [
    buildCreateClusterReassignmentDiscoveryEventArgs({
      inspirationId: "insp-reassigned",
      newClusterId: "cluster_next",
      previousClusterId: "cluster_previous",
      userId: "user-discovery",
    }),
  ]);
});

test("handleUpdateInspirationRouteRequest skips cluster reassignment discovery events when the capture is only entering its first cluster", async () => {
  const {
    client,
    discoveryEventCreateCalls,
    findFirstCalls,
  } = createPersistenceClient({
    currentClusterId: null,
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-first-cluster", {
      method: "PUT",
      body: JSON.stringify({
        clusterId: "cluster_first",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-discovery";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
      params: {
        inspirationId: "insp-first-cluster",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.equal(findFirstCalls.length, 1);
  assert.deepEqual(discoveryEventCreateCalls, []);
});

test("handleUpdateInspirationRouteRequest returns persisted voice upload metadata after updating a voice note", async () => {
  const { client } = createPersistenceClient({
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-voice", {
      method: "PUT",
      body: JSON.stringify({
        audioStorageKey: "users/user-42/voice-notes/insp-voice.webm",
        audioStorageUrl: "https://waka.app/media/insp-voice.webm",
        audioMimeType: "audio/webm",
        audioSizeBytes: 2048,
        audioDurationSeconds: 12.4,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
      params: {
        inspirationId: "insp-voice",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-voice",
    rawContent: "Existing persisted capture.",
    sourceType: "TEXT_NOTE",
    audioStorageKey: "users/user-42/voice-notes/insp-voice.webm",
    audioStorageUrl: "https://waka.app/media/insp-voice.webm",
    audioMimeType: "audio/webm",
    audioSizeBytes: 2048,
    audioDurationSeconds: 12.4,
  });
});

test("handleUpdateInspirationRouteRequest makes an inspiration public with a generated share slug", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-shareable", {
      method: "PUT",
      body: JSON.stringify({
        isPublic: true,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-share";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
        shareSlugGenerator() {
          return "insp_sharepublic123";
        },
      },
      params: {
        inspirationId: "insp-shareable",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-shareable",
    isPublic: true,
    rawContent: "Existing persisted capture.",
    shareSlug: "insp_sharepublic123",
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(updateCalls, [
    {
      data: {
        isPublic: true,
        shareSlug: "insp_sharepublic123",
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "insp-shareable",
          userId: "user-share",
        },
      },
    },
  ]);
  assert.deepEqual(enqueuedPayloads, []);
});

test("handleUpdateInspirationRouteRequest clears share state when an inspiration is made private", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-private", {
      method: "PUT",
      body: JSON.stringify({
        isPublic: false,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-share";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
      params: {
        inspirationId: "insp-private",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-private",
    isPublic: false,
    rawContent: "Existing persisted capture.",
    shareSlug: null,
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(updateCalls, [
    {
      data: {
        isPublic: false,
        shareSlug: null,
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "insp-private",
          userId: "user-share",
        },
      },
    },
  ]);
});

test("handleUpdateInspirationRouteRequest retries share slug generation when the first slug collides", async () => {
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const updateCalls: UpdateInspirationPersistenceArgs[] = [];
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const generatedSlugs = ["insp_collision", "insp_recovered"];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-collision", {
      method: "PUT",
      body: JSON.stringify({
        isPublic: true,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-share";
          },
        },
        enrichmentPipeline,
        persistence: {
          discoveryEvent: {
            async create() {
              throw new Error("sharing collisions should not create discovery events");
            },
          },
          inspiration: {
            async findFirst(args) {
              return {
                clusterId: "cluster-existing",
                id: args.where.id,
              };
            },
            async update(args) {
              updateCalls.push(args);

              if (args.data.shareSlug === "insp_collision") {
                throw {
                  code: "P2002",
                  meta: {
                    target: ["shareSlug"],
                  },
                  name: "PrismaClientKnownRequestError",
                };
              }

              return {
                id: args.where.userId_id.id,
                rawContent: "Existing persisted capture.",
                rawContentChanged: false,
                sourceType: "TEXT_NOTE",
              } satisfies UpdatedInspirationRecord;
            },
          },
        },
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
        shareSlugGenerator() {
          return generatedSlugs.shift() ?? "insp_unexpected";
        },
      },
      params: {
        inspirationId: "insp-collision",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-collision",
    isPublic: true,
    rawContent: "Existing persisted capture.",
    shareSlug: "insp_recovered",
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(
    updateCalls.map((call) => call.data.shareSlug),
    ["insp_collision", "insp_recovered"],
  );
  assert.deepEqual(enqueuedPayloads, []);
});

test("handleUpdateInspirationRouteRequest returns 200 immediately and defers ai_enrichment queue dispatch after persistence when rawContent changes", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: true,
  });
  const { client: enrichmentPipeline, updateCalls: enrichmentUpdateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  const startedAt = performance.now();
  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-updated", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "Capture edits should re-enrich asynchronously.",
        userId: "forged-user",
        ownerId: "forged-owner",
        tenantId: "forged-tenant",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
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
      params: {
        inspirationId: "insp-updated",
      },
    },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-updated",
    rawContent: "Capture edits should re-enrich asynchronously.",
    sourceType: "TEXT_NOTE",
  });
  assert.ok(
    elapsedMs < 500,
    `expected the response path to stay under 500ms, got ${elapsedMs.toFixed(2)}ms`,
  );
  assert.deepEqual(updateCalls, [
    {
      data: {
        rawContent: "Capture edits should re-enrich asynchronously.",
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "insp-updated",
          userId: "user-42",
        },
      },
    },
  ]);
  assert.equal(
    enqueuedPayloads.length,
    0,
    "queue dispatch should not block the synchronous update response path",
  );
  assert.equal(
    enrichmentUpdateCalls.length,
    0,
    "pipeline metadata refresh should stay off the synchronous update response path",
  );

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp-updated",
    },
  ]);
  assert.equal(enrichmentUpdateCalls.length, 1);
  assert.equal(enrichmentUpdateCalls[0]?.where.userId_id.userId, "user-42");
  assert.equal(enrichmentUpdateCalls[0]?.where.userId_id.id, "insp-updated");
  assert.equal(enrichmentUpdateCalls[0]?.data.enrichmentStatus, "PENDING");
  assert.equal(enrichmentUpdateCalls[0]?.data.enrichmentAttemptCount, 0);
  assert.equal(
    enrichmentUpdateCalls[0]?.data.enrichmentMaxAttemptCount,
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  assert.deepEqual(
    enrichmentUpdateCalls[0]?.data.enrichmentFields,
    buildPendingInspirationEnrichmentFields(
      INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    ),
  );
  assert.equal(enrichmentUpdateCalls[0]?.data.enrichmentLastError, null);
  assert.equal(
    enrichmentUpdateCalls[0]?.data.enrichmentLastFailureReason,
    null,
  );
  assert.equal(
    enrichmentUpdateCalls[0]?.data.enrichmentLastFailureRetryability,
    null,
  );
  assert.equal(enrichmentUpdateCalls[0]?.data.enrichmentResumeState, null);
  assert.ok(
    enrichmentUpdateCalls[0]?.data.enrichmentEnqueuedAt instanceof Date,
  );
});

test("handleUpdateInspirationRouteRequest persists a reflection answer and defers reflection re-embedding without resetting the enrichment pipeline", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: false,
  });
  const { client: enrichmentPipeline, updateCalls: enrichmentUpdateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  const startedAt = performance.now();
  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-reflection-answer", {
      method: "PUT",
      body: JSON.stringify({
        reflectionAnswer:
          "It exposed the tradeoff between quick capture and delayed synthesis.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-reflection";
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
      params: {
        inspirationId: "insp-reflection-answer",
      },
    },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-reflection-answer",
    rawContent: "Existing persisted capture.",
    sourceType: "TEXT_NOTE",
  });
  assert.ok(
    elapsedMs < 500,
    `expected the reflection answer response path to stay under 500ms, got ${elapsedMs.toFixed(2)}ms`,
  );
  assert.deepEqual(updateCalls, [
    {
      data: {
        reflectionAnswer:
          "It exposed the tradeoff between quick capture and delayed synthesis.",
        reflectionStatus: "ANSWERED",
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "insp-reflection-answer",
          userId: "user-reflection",
        },
      },
    },
  ]);
  assert.deepEqual(enqueuedPayloads, []);
  assert.deepEqual(enrichmentUpdateCalls, []);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "reflection_reembedding",
      inspirationId: "insp-reflection-answer",
    },
  ]);
  assert.deepEqual(
    enrichmentUpdateCalls,
    [],
    "reflection answer refresh should reuse the existing pipeline state instead of resetting it",
  );
});

test("handleUpdateInspirationRouteRequest succeeds once persistence completes even if async enrichment enqueue fails later", async () => {
  const enqueueFailure = new Error("SQS temporarily unavailable.");
  const asyncTasks = createAsyncTaskHarness();
  const events: string[] = [];
  const loggedErrors: unknown[] = [];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-updated", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "Persistence should decide update success.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-queue-failure";
          },
        },
        backgroundScheduler(task) {
          events.push("scheduler:queued");
          asyncTasks.schedule(task);
        },
        enrichmentPipeline: {
          inspiration: {
            async findFirst() {
              return null;
            },
            async update(args) {
              events.push("pipeline:update");

              return {
                id: args.where.userId_id.id,
              };
            },
          },
        },
        logger: {
          error(error) {
            events.push("queue:error");
            loggedErrors.push(error);
          },
        },
        persistence: {
          discoveryEvent: {
            async create() {
              throw new Error(
                "cluster reassignment events should not be written for raw-content-only updates",
              );
            },
          },
          inspiration: {
            async findFirst(args) {
              return {
                clusterId: "cluster-existing",
                id: args.where.id,
              };
            },
            async update() {
              events.push("persistence:update");

              return {
                id: "insp-updated",
                rawContent: "Persistence should decide update success.",
                sourceType: "TEXT_NOTE",
                rawContentChanged: true,
              } satisfies UpdatedInspirationRecord;
            },
          },
        },
        queuePublisher: {
          async enqueue() {
            events.push("queue:enqueue");
            throw enqueueFailure;
          },
        },
      },
      params: {
        inspirationId: "insp-updated",
      },
    },
  );

  events.push("response:resolved");

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-updated",
    rawContent: "Persistence should decide update success.",
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(events, [
    "persistence:update",
    "scheduler:queued",
    "response:resolved",
  ]);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(events, [
    "persistence:update",
    "scheduler:queued",
    "response:resolved",
    "queue:enqueue",
    "queue:error",
  ]);
  assert.deepEqual(loggedErrors, [enqueueFailure]);
});

test("handleUpdateInspirationRouteRequest skips queue dispatch when rawContent did not change and resolves manually supplied AI fields inline", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: false,
  });
  const {
    client: enrichmentPipeline,
    findFirstCalls,
    updateCalls: enrichmentUpdateCalls,
  } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-unchanged", {
      method: "PUT",
      body: JSON.stringify({
        title: "Retitle without re-embedding",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
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
      params: {
        inspirationId: "insp-unchanged",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-unchanged",
    rawContent: "Existing persisted capture.",
    sourceType: "TEXT_NOTE",
  });
  assert.equal(findFirstCalls.length, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.title, "Retitle without re-embedding");
  assert.equal(
    updateCalls[0]?.data.enrichmentFields?.title.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
  assert.equal(updateCalls[0]?.data.enrichmentStatus, "PENDING");
  assert.deepEqual(
    updateCalls[0]?.data.enrichmentResumeState?.remainingFieldNames,
    ["embedding", "summary", "tags", "domain", "mood", "actionability"],
  );

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, []);
  assert.deepEqual(enrichmentUpdateCalls, []);
});

test("handleUpdateInspirationRouteRequest manually resolves selected failed AI fields without reprocessing unaffected fields", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: false,
  });
  const persistedEnrichmentFields = createInspirationEnrichmentFields(
    (fieldName) => {
      if (fieldName === "embedding") {
        return buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          completedAt: new Date("2026-04-10T03:58:00.000Z"),
          maxAttemptCount: 3,
          startedAt: new Date("2026-04-10T03:57:00.000Z"),
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: 1,
        failedAt: new Date("2026-04-10T04:00:00.000Z"),
        lastFailureReason: `Failed ${fieldName}.`,
        maxAttemptCount: 3,
        startedAt: new Date("2026-04-10T03:59:00.000Z"),
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
      });
    },
  );
  const resumeState = {
    capture: {
      mediaUrl: null,
      rawContent: "Keep manual recovery scoped to the failed field.",
      sourceMeta: null,
      sourceUrl: null,
      title: "Old title",
      transcript: null,
    },
    completedFieldNames: ["embedding"],
    completedOutputs: {},
    remainingFieldNames: [
      "title",
      "summary",
      "tags",
      "domain",
      "mood",
      "actionability",
    ],
    updatedAt: "2026-04-10T04:00:00.000Z",
  } as const;
  const findFirstCalls: unknown[] = [];
  const queuePayloads: SupportedSqsJobPayload[] = [];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-manual", {
      method: "PUT",
      body: JSON.stringify({
        summary: "Manual summary keeps the rest of the pipeline untouched.",
        tags: ["manual", "recovery"],
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
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

              return {
                embedding: [0.12, 0.34, 0.56],
                enrichmentFields: persistedEnrichmentFields,
                enrichmentResumeState: resumeState,
                id: "insp-manual",
                rawContent: "Keep manual recovery scoped to the failed field.",
                title: "Old title",
              };
            },
            async update() {
              throw new Error("manual recovery should not enqueue pipeline work");
            },
          },
        },
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            queuePayloads.push(payload);
          },
        },
      },
      params: {
        inspirationId: "insp-manual",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-manual",
    rawContent: "Existing persisted capture.",
    sourceType: "TEXT_NOTE",
  });
  assert.equal(findFirstCalls.length, 1);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(queuePayloads, []);
  assert.equal(
    updateCalls[0]?.data.summary,
    "Manual summary keeps the rest of the pipeline untouched.",
  );
  assert.deepEqual(updateCalls[0]?.data.tags, ["manual", "recovery"]);
  assert.equal(
    updateCalls[0]?.data.enrichmentFields?.summary.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
  assert.equal(
    updateCalls[0]?.data.enrichmentFields?.tags.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
  assert.equal(
    updateCalls[0]?.data.enrichmentFields?.title.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  );
  assert.equal(
    updateCalls[0]?.data.enrichmentStatus,
    INSPIRATION_ENRICHMENT_STATUS_FAILED,
  );
  assert.deepEqual(
    updateCalls[0]?.data.enrichmentResumeState?.remainingFieldNames,
    ["domain", "mood", "actionability"],
  );
  assert.equal(
    updateCalls[0]?.data.enrichmentResumeState?.completedOutputs.summary,
    "Manual summary keeps the rest of the pipeline untouched.",
  );
  assert.deepEqual(
    updateCalls[0]?.data.enrichmentResumeState?.completedOutputs.tags,
    ["manual", "recovery"],
  );
});

test("handleUpdateInspirationRouteRequest returns the shared not-found contract when the requested inspiration cannot be updated", async () => {
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-missing", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "Missing capture",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline,
        persistence: {
          discoveryEvent: {
            async create() {
              throw new Error("not-found updates should not write discovery events");
            },
          },
          inspiration: {
            async findFirst(args) {
              return {
                clusterId: "cluster-existing",
                id: args.where.id,
              };
            },
            async update() {
              throw new UpdateInspirationNotFoundError();
            },
          },
        },
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
      },
      params: {
        inspirationId: "insp-missing",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: UPDATE_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.deepEqual(enqueuedPayloads, []);
});

test("handleUpdateInspirationRouteRequest maps Prisma not-found errors to the same shared not-found contract for cross-user updates", async () => {
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-owned-by-another-user", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "A different user's capture should not be writable.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline,
        persistence: {
          discoveryEvent: {
            async create() {
              throw new Error("cross-user failures should not write discovery events");
            },
          },
          inspiration: {
            async findFirst(args) {
              return {
                clusterId: "cluster-existing",
                id: args.where.id,
              };
            },
            async update() {
              throw {
                code: "P2025",
                name: "PrismaClientKnownRequestError",
              };
            },
          },
        },
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
      },
      params: {
        inspirationId: "insp-owned-by-another-user",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: UPDATE_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.deepEqual(enqueuedPayloads, []);
});

test("handleUpdateInspirationRouteRequest returns the same generic failure response for cross-user and missing updates", async () => {
  const { client: crossUserEnrichmentPipeline } = createEnrichmentPipelineClient();
  const { client: missingEnrichmentPipeline } = createEnrichmentPipelineClient();
  const crossUserEnqueuedPayloads: SupportedSqsJobPayload[] = [];
  const missingEnqueuedPayloads: SupportedSqsJobPayload[] = [];

  const crossUserResponse = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-secret", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "A different user's capture should stay indistinguishable from a missing one.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline: crossUserEnrichmentPipeline,
        persistence: {
          discoveryEvent: {
            async create() {
              throw new Error("cross-user failures should not write discovery events");
            },
          },
          inspiration: {
            async findFirst(args) {
              return {
                clusterId: "cluster-existing",
                id: args.where.id,
              };
            },
            async update() {
              throw {
                code: "P2025",
                name: "PrismaClientKnownRequestError",
              };
            },
          },
        },
        queuePublisher: {
          async enqueue(payload) {
            crossUserEnqueuedPayloads.push(payload);
          },
        },
      },
      params: {
        inspirationId: "insp-secret",
      },
    },
  );

  const missingResponse = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-missing", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "A missing capture should share the same public failure shape.",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        enrichmentPipeline: missingEnrichmentPipeline,
        persistence: {
          discoveryEvent: {
            async create() {
              throw new Error("missing updates should not write discovery events");
            },
          },
          inspiration: {
            async findFirst(args) {
              return {
                clusterId: "cluster-existing",
                id: args.where.id,
              };
            },
            async update() {
              throw new UpdateInspirationNotFoundError();
            },
          },
        },
        queuePublisher: {
          async enqueue(payload) {
            missingEnqueuedPayloads.push(payload);
          },
        },
      },
      params: {
        inspirationId: "insp-missing",
      },
    },
  );

  assert.deepEqual(
    {
      body: await crossUserResponse.json(),
      status: crossUserResponse.status,
    },
    {
      body: await missingResponse.json(),
      status: missingResponse.status,
    },
  );
  assert.deepEqual(crossUserEnqueuedPayloads, []);
  assert.deepEqual(missingEnqueuedPayloads, []);
});

test("app/api/inspirations/[id]/route.ts ignores spoofed ownership fields on PUT and uses the authenticated owner", async () => {
  const { client, updateCalls } = createPersistenceClient({
    rawContentChanged: true,
  });
  const { client: enrichmentPipeline, updateCalls: enrichmentUpdateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: SupportedSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  configureUpdateInspirationRouteDependencies({
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
    const { PUT } = await import(
      "../apps/web/app/api/inspirations/[id]/route.ts"
    );
    const response = await PUT(
      new Request("https://waka.app/api/inspirations/insp-route", {
        method: "PUT",
        body: JSON.stringify({
          rawContent: "Route handler delegation stays thin for updates.",
          ownerId: "forged-owner",
          userId: "forged-user",
          tenantId: "forged-tenant",
          workspaceId: "forged-workspace",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
      {
        params: Promise.resolve({
          id: "insp-route",
        }),
      },
    );

    assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      id: "insp-route",
      rawContent: "Route handler delegation stays thin for updates.",
      sourceType: "TEXT_NOTE",
    });

    await asyncTasks.flushScheduledTasks();

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.where.userId_id.userId, "user-route");
    assert.equal("ownerId" in (updateCalls[0]?.data ?? {}), false);
    assert.equal("userId" in (updateCalls[0]?.data ?? {}), false);
    assert.equal("tenantId" in (updateCalls[0]?.data ?? {}), false);
    assert.equal("workspaceId" in (updateCalls[0]?.data ?? {}), false);
    assert.deepEqual(enqueuedPayloads, [
      {
        jobType: "ai_enrichment",
        inspirationId: "insp-route",
      },
    ]);
    assert.equal(enrichmentUpdateCalls.length, 1);
  } finally {
    configureUpdateInspirationRouteDependencies(null);
  }
});

test("handleUpdateInspirationRouteRequest returns 400 for invalid update payloads", async () => {
  const { client, updateCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleUpdateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-invalid", {
      method: "PUT",
      body: JSON.stringify({
        rawContent: "",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-7";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
      params: {
        inspirationId: "insp-invalid",
      },
    },
  );

  assert.equal(response.status, UPDATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: UPDATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR,
  });
  assert.equal(updateCalls.length, 0);
});
