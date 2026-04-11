import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildPendingInspirationEnrichmentFields } from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_INVALID_ERROR,
  CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR,
  CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_INVALID_ERROR,
  CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_PROVIDER_UNSUPPORTED_ERROR,
  CREATE_INSPIRATION_AI_CONVERSATION_TURN_COUNT_INVALID_ERROR,
  CREATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR,
  CREATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR,
  CREATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
  CREATE_INSPIRATION_ROUTE_CREATED_STATUS,
  CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
  buildCreateInspirationProcessingState,
  buildCreateInspirationPersistenceArgs,
  configureCreateInspirationRouteDependencies,
  handleCreateInspirationRouteRequest,
  parseCreateInspirationRequestBody,
  type CreateInspirationBackgroundScheduler,
  type CreateInspirationPersistenceClient,
  type CreatedInspirationRecord,
} from "../apps/web/src/inspirations/create-route.ts";
import type { AiEnrichmentSqsJobPayload } from "../packages/shared/types.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INITIAL_INSPIRATION_ENRICHMENT_STATUS,
  buildInitialInspirationEnrichmentPersistenceData,
  type MarkInspirationEnrichmentEnqueuedPersistenceArgs,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

function createPersistenceClient(): {
  createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      audioDurationSeconds: true;
      audioMimeType: true;
      audioSizeBytes: true;
      audioStorageKey: true;
      audioStorageUrl: true;
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }>;
  client: CreateInspirationPersistenceClient;
} {
  const createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      audioDurationSeconds: true;
      audioMimeType: true;
      audioSizeBytes: true;
      audioStorageKey: true;
      audioStorageUrl: true;
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }> = [];

  return {
    createCalls,
    client: {
      inspiration: {
        async create(args) {
          createCalls.push(args as typeof createCalls[number]);

          return {
            ...(typeof args.data.audioStorageKey === "string"
              ? { audioStorageKey: args.data.audioStorageKey }
              : {}),
            ...(typeof args.data.audioStorageUrl === "string"
              ? { audioStorageUrl: args.data.audioStorageUrl }
              : {}),
            ...(typeof args.data.audioMimeType === "string"
              ? { audioMimeType: args.data.audioMimeType }
              : {}),
            ...(typeof args.data.audioSizeBytes === "number"
              ? { audioSizeBytes: args.data.audioSizeBytes }
              : {}),
            ...(typeof args.data.audioDurationSeconds === "number"
              ? { audioDurationSeconds: args.data.audioDurationSeconds }
              : {}),
            id: "insp_created",
            rawContent: String(args.data.rawContent),
            sourceType: args.data.sourceType as CreatedInspirationRecord["sourceType"],
          };
        },
      },
    },
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

test("buildCreateInspirationPersistenceArgs persists the initial pending enrichment state at capture creation time", () => {
  assert.deepEqual(
    buildCreateInspirationPersistenceArgs("user-1", {
      rawContent: "Capture first, enrich later.",
      sourceType: "TEXT_NOTE",
      title: "Quick note",
      sourceUrl: "https://waka.app/source",
      sourceMeta: {
        provider: "manual",
      },
      mediaUrl: "https://waka.app/media.m4a",
      transcript: "Capture first, enrich later.",
      parentId: "parent-1",
      sourceParentId: "source-parent-1",
      clusterId: "cluster-1",
    }),
    {
      data: {
        userId: "user-1",
        originalRawContent: "Capture first, enrich later.",
        rawContent: "Capture first, enrich later.",
        sourceType: "TEXT_NOTE",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        originalTitle: "Quick note",
        title: "Quick note",
        originalSourceUrl: "https://waka.app/source",
        sourceUrl: "https://waka.app/source",
        originalSourceMeta: {
          provider: "manual",
        },
        sourceMeta: {
          provider: "manual",
        },
        originalMediaUrl: "https://waka.app/media.m4a",
        mediaUrl: "https://waka.app/media.m4a",
        audioStorageUrl: "https://waka.app/media.m4a",
        originalTranscript: "Capture first, enrich later.",
        transcript: "Capture first, enrich later.",
        parentId: "parent-1",
        sourceParentId: "source-parent-1",
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
    },
  );
});

test("buildCreateInspirationPersistenceArgs classifies URL imports as not needing reflection", () => {
  assert.deepEqual(
    buildCreateInspirationPersistenceArgs("user-url", {
      rawContent: "https://example.com/article",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://example.com/article",
    }),
    {
      data: {
        userId: "user-url",
        originalRawContent: "https://example.com/article",
        rawContent: "https://example.com/article",
        reflectionStatus: "NOT_NEEDED",
        sourceType: "URL_IMPORT",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        originalSourceUrl: "https://example.com/article",
        sourceUrl: "https://example.com/article",
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
    },
  );
});

test("buildCreateInspirationPersistenceArgs persists dedicated voice upload fields alongside the legacy mediaUrl", () => {
  assert.deepEqual(
    buildCreateInspirationPersistenceArgs("user-voice", {
      rawContent: "Voice note transcript",
      sourceType: "VOICE_NOTE",
      mediaUrl: "https://waka.app/media/voice-note.webm",
      sourceMeta: {
        durationSeconds: 12.4,
        mimeType: "audio/webm",
        sizeBytes: 2048,
      },
      audioStorageKey: "users/user-voice/voice-notes/voice-note.webm",
      transcript: "Voice note transcript",
    }),
    {
      data: {
        userId: "user-voice",
        originalRawContent: "Voice note transcript",
        rawContent: "Voice note transcript",
        sourceType: "VOICE_NOTE",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        originalSourceMeta: {
          durationSeconds: 12.4,
          mimeType: "audio/webm",
          sizeBytes: 2048,
        },
        sourceMeta: {
          durationSeconds: 12.4,
          mimeType: "audio/webm",
          sizeBytes: 2048,
        },
        originalMediaUrl: "https://waka.app/media/voice-note.webm",
        mediaUrl: "https://waka.app/media/voice-note.webm",
        audioStorageKey: "users/user-voice/voice-notes/voice-note.webm",
        audioStorageUrl: "https://waka.app/media/voice-note.webm",
        audioMimeType: "audio/webm",
        audioSizeBytes: 2048,
        audioDurationSeconds: 12.4,
        audioTranscriptionStatus: "COMPLETED",
        originalTranscript: "Voice note transcript",
        transcript: "Voice note transcript",
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
    },
  );
});

test("buildCreateInspirationPersistenceArgs snapshots imported AI conversation transcripts before async enrichment", () => {
  assert.deepEqual(
    buildCreateInspirationPersistenceArgs("user-ai-import", {
      rawContent:
        "User: Preserve the full imported conversation.\nAssistant: Persist it before downstream enrichment.",
      sourceType: "AI_CONVERSATION",
      sourceUrl: "https://chatgpt.com/share/persist-this-thread",
      sourceMeta: {
        conversationTitle: "Imported conversation",
        provider: "chatgpt",
        turnCount: 2,
      },
    }),
    {
      data: {
        userId: "user-ai-import",
        originalRawContent:
          "User: Preserve the full imported conversation.\nAssistant: Persist it before downstream enrichment.",
        rawContent:
          "User: Preserve the full imported conversation.\nAssistant: Persist it before downstream enrichment.",
        sourceType: "AI_CONVERSATION",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        originalSourceUrl: "https://chatgpt.com/share/persist-this-thread",
        sourceUrl: "https://chatgpt.com/share/persist-this-thread",
        originalSourceMeta: {
          conversationTitle: "Imported conversation",
          provider: "chatgpt",
          sourceConversationRef:
            "ai-conversation-ref:v1:chatgpt:url=https://chatgpt.com/share/persist-this-thread",
          turnCount: 2,
        },
        sourceMeta: {
          conversationTitle: "Imported conversation",
          provider: "chatgpt",
          sourceConversationRef:
            "ai-conversation-ref:v1:chatgpt:url=https://chatgpt.com/share/persist-this-thread",
          turnCount: 2,
        },
        sourceConversationRef:
          "ai-conversation-ref:v1:chatgpt:url=https://chatgpt.com/share/persist-this-thread",
        originalTranscript:
          "User: Preserve the full imported conversation.\nAssistant: Persist it before downstream enrichment.",
        transcript:
          "User: Preserve the full imported conversation.\nAssistant: Persist it before downstream enrichment.",
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
    },
  );
});

test("parseCreateInspirationRequestBody accepts a single-character inspiration and preserves rawContent", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "x",
        sourceType: "TEXT_NOTE",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent: "x",
    sourceType: "TEXT_NOTE",
  });
});

test("parseCreateInspirationRequestBody accepts dedicated voice upload metadata fields", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Voice note transcript",
        sourceType: "VOICE_NOTE",
        mediaUrl: "https://waka.app/media/voice-note.webm",
        audioStorageKey: "users/user-voice/voice-notes/voice-note.webm",
        audioStorageUrl: "https://waka.app/media/voice-note.webm",
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
    rawContent: "Voice note transcript",
    sourceType: "VOICE_NOTE",
    mediaUrl: "https://waka.app/media/voice-note.webm",
    audioStorageKey: "users/user-voice/voice-notes/voice-note.webm",
    audioStorageUrl: "https://waka.app/media/voice-note.webm",
    audioMimeType: "audio/webm",
    audioSizeBytes: 2048,
    audioDurationSeconds: 12.4,
  });
});

test("parseCreateInspirationRequestBody accepts AI conversation transcript imports with normalized provider metadata", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent:
          "User: Connect scattered inspirations.\nAssistant: Cluster them semantically.",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          conversationTitle: " Clustering notes ",
          model: " gpt-4o ",
          provider: " ChatGPT ",
          turnCount: 4,
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent:
      "User: Connect scattered inspirations.\nAssistant: Cluster them semantically.",
    sourceType: "AI_CONVERSATION",
    sourceMeta: {
      conversationTitle: "Clustering notes",
      model: "gpt-4o",
      provider: "chatgpt",
      turnCount: 4,
    },
  });
});

test("parseCreateInspirationRequestBody preserves canonicalized AI conversation source identity and context metadata", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent:
          "User: Normalize import metadata.\nAssistant: Keep the canonical result stable.",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          assistant_name: "ChatGPT",
          conversation_id: "conversation-123",
          message_count: 8,
          participants: [
            {
              display_name: "User",
              email: "user@example.com",
              metadata: {
                locale: "en-US",
              },
              participant_id: "participant-user",
              participant_role: "user",
            },
            {
              display_name: "ChatGPT",
              id: "assistant-1",
              metadata: {
                modelProvider: "openai",
              },
              model_slug: "gpt-4o",
            },
          ],
          participant_roles: ["user", "assistant"],
          provider: " chatgpt ",
          source_id: "share-abc",
          workspace_id: "workspace-9",
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent:
      "User: Normalize import metadata.\nAssistant: Keep the canonical result stable.",
    sourceType: "AI_CONVERSATION",
    sourceMeta: {
      assistantName: "ChatGPT",
      conversationId: "conversation-123",
      messageCount: 8,
      participantCount: 2,
      participantNames: ["User", "ChatGPT"],
      participants: [
        {
          name: "User",
          role: "user",
          sourceId: "participant-user",
          sourceMetadata: {
            email: "user@example.com",
            locale: "en-US",
          },
        },
        {
          name: "ChatGPT",
          role: "assistant",
          sourceId: "assistant-1",
          sourceMetadata: {
            modelProvider: "openai",
            model_slug: "gpt-4o",
          },
        },
      ],
      participantRoles: ["user", "assistant"],
      provider: "chatgpt",
      sourceConversationRef:
        "ai-conversation-ref:v1:chatgpt:conversation=conversation-123",
      sourceId: "share-abc",
      workspaceId: "workspace-9",
    },
  });
});

test("parseCreateInspirationRequestBody translates source-specific AI conversation participant roles and retains sourceRole metadata", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent:
          "User: Canonicalize provider roles.\nAssistant: Keep the source role for traceability.",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          participants: [
            {
              display_name: "Founder",
              participant_role: "human",
            },
            {
              display_name: "Gemini",
              role: "model",
            },
          ],
          provider: "gemini",
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent:
      "User: Canonicalize provider roles.\nAssistant: Keep the source role for traceability.",
    sourceType: "AI_CONVERSATION",
    sourceMeta: {
      participantCount: 2,
      participantNames: ["Founder", "Gemini"],
      participants: [
        {
          name: "Founder",
          role: "user",
          sourceMetadata: {
            sourceRole: "human",
          },
        },
        {
          name: "Gemini",
          role: "assistant",
          sourceMetadata: {
            sourceRole: "model",
          },
        },
      ],
      participantRoles: ["user", "assistant"],
      provider: "gemini",
    },
  });
});

test("parseCreateInspirationRequestBody normalizes AI conversation share links from sourceMeta", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "https://claude.ai/share/abc123",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          conversationTitle: "Reliability pass",
          conversationUrl: " https://claude.ai/share/abc123 ",
          provider: "claude",
          turnCount: 6,
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent: "https://claude.ai/share/abc123",
    sourceType: "AI_CONVERSATION",
    sourceUrl: "https://claude.ai/share/abc123",
    sourceMeta: {
      conversationTitle: "Reliability pass",
      conversationUrl: "https://claude.ai/share/abc123",
      provider: "claude",
      sourceConversationRef:
        "ai-conversation-ref:v1:claude:url=https://claude.ai/share/abc123",
      turnCount: 6,
    },
  });
});

test("parseCreateInspirationRequestBody normalizes AI conversation timestamp aliases into canonical sourceMeta fields", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent:
          "User: Keep source timestamps stable.\nAssistant: Normalize them before persistence.",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          provider: " ChatGPT ",
          published_at: "2026-04",
          turns: [
            {
              create_time: 1712793600,
              role: "user",
              text: "Keep source timestamps stable.",
            },
            {
              captured_at: "2024-04-11 01:00:00",
              role: "assistant",
              text: "Normalize them before persistence.",
            },
          ],
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent:
      "User: Keep source timestamps stable.\nAssistant: Normalize them before persistence.",
    sourceType: "AI_CONVERSATION",
    sourceMeta: {
      capturedAt: "2024-04-11T00:00:00.000Z",
      provider: "chatgpt",
      publishedAt: "2026-04-01T00:00:00.000Z",
      turnCount: 2,
      turns: [
        {
          capturedAt: "2024-04-11T00:00:00.000Z",
          role: "user",
          text: "Keep source timestamps stable.",
        },
        {
          capturedAt: "2024-04-11T01:00:00.000Z",
          role: "assistant",
          text: "Normalize them before persistence.",
        },
      ],
      updatedAt: "2024-04-11T01:00:00.000Z",
    },
  });
});

test("parseCreateInspirationRequestBody strips client-supplied ownership fields", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Keep this draft private.",
        sourceType: "TEXT_NOTE",
        ownerId: "forged-owner",
        userId: "forged-user",
        tenantId: "forged-tenant",
        workspaceId: "forged-workspace",
        sourceParentId: "forged-source-parent",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent: "Keep this draft private.",
    sourceType: "TEXT_NOTE",
  });
  assert.equal("ownerId" in parsedRequestBody, false);
  assert.equal("userId" in parsedRequestBody, false);
  assert.equal("tenantId" in parsedRequestBody, false);
  assert.equal("workspaceId" in parsedRequestBody, false);
  assert.equal("sourceParentId" in parsedRequestBody, false);
});

test("parseCreateInspirationRequestBody rejects invalid JSON and empty rawContent", async () => {
  await assert.rejects(
    async () =>
      parseCreateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations", {
          method: "POST",
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
      parseCreateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations", {
          method: "POST",
          body: JSON.stringify({
            rawContent: "",
            sourceType: "TEXT_NOTE",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR),
  );
});

test("parseCreateInspirationRequestBody rejects malformed AI conversation metadata", async () => {
  await assert.rejects(
    async () =>
      parseCreateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations", {
          method: "POST",
          body: JSON.stringify({
            rawContent: "User: Validate the AI conversation parser.",
            sourceType: "AI_CONVERSATION",
            sourceMeta: {
              provider: "claude",
              turnCount: 0,
            },
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_INSPIRATION_AI_CONVERSATION_TURN_COUNT_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCreateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations", {
          method: "POST",
          body: JSON.stringify({
            rawContent: "User: Validate the AI conversation parser.",
            sourceType: "AI_CONVERSATION",
            sourceMeta: {
              conversationUrl: "not-a-url",
              provider: "chatgpt",
            },
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(
      CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_INVALID_ERROR,
    ),
  );
});

test("parseCreateInspirationRequestBody rejects unsupported AI conversation share-link providers and hosts", async () => {
  await assert.rejects(
    async () =>
      parseCreateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations", {
          method: "POST",
          body: JSON.stringify({
            rawContent: "https://example.com/conversations/other",
            sourceType: "AI_CONVERSATION",
            sourceMeta: {
              conversationUrl: "https://example.com/conversations/other",
              provider: "other",
            },
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(
      CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_PROVIDER_UNSUPPORTED_ERROR,
    ),
  );

  await assert.rejects(
    async () =>
      parseCreateInspirationRequestBody(
        new Request("https://waka.app/api/inspirations", {
          method: "POST",
          body: JSON.stringify({
            rawContent: "https://claude.ai/share/not-chatgpt",
            sourceType: "AI_CONVERSATION",
            sourceMeta: {
              provider: "chatgpt",
            },
            sourceUrl: "https://claude.ai/share/not-chatgpt",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_INVALID_ERROR),
  );
});

test("handleCreateInspirationRouteRequest returns 401 when the caller is not authenticated", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Keep drafts durable.",
        sourceType: "TEXT_NOTE",
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
    },
  );

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(createCalls.length, 0);
  assert.equal(enqueuedPayloads.length, 0);
});

test("handleCreateInspirationRouteRequest returns a consistent 400 error for missing AI conversation providers", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "User: Which provider should own this import?",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          conversationTitle: "Missing provider",
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-ai-conversation";
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

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR,
  });
  assert.equal(createCalls.length, 0);
});

test("handleCreateInspirationRouteRequest persists ownership from auth context instead of the client payload", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Auth context should own this capture.",
        sourceType: "TEXT_NOTE",
        ownerId: "forged-owner",
        userId: "forged-user",
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
    },
  );

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]?.data.userId, "user-authenticated");
  assert.equal("ownerId" in (createCalls[0]?.data ?? {}), false);
  assert.equal("tenantId" in (createCalls[0]?.data ?? {}), false);
  assert.equal("workspaceId" in (createCalls[0]?.data ?? {}), false);
});

test("handleCreateInspirationRouteRequest returns persisted voice upload metadata for voice notes", async () => {
  const { client } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const asyncTasks = createAsyncTaskHarness();

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Voice note transcript",
        sourceType: "VOICE_NOTE",
        audioStorageKey: "users/user-voice/voice-notes/insp-created.webm",
        audioStorageUrl: "https://waka.app/media/insp-created.webm",
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
            return "user-voice";
          },
        },
        backgroundScheduler: asyncTasks.schedule,
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
    },
  );

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp_created",
    processingState: buildCreateInspirationProcessingState(),
    rawContent: "Voice note transcript",
    sourceType: "VOICE_NOTE",
    audioStorageKey: "users/user-voice/voice-notes/insp-created.webm",
    audioStorageUrl: "https://waka.app/media/insp-created.webm",
    audioMimeType: "audio/webm",
    audioSizeBytes: 2048,
    audioDurationSeconds: 12.4,
  });
});

test("handleCreateInspirationRouteRequest persists resolved AI conversation participant identities before enqueueing enrichment", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const asyncTasks = createAsyncTaskHarness();

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent:
          "User: Keep participant identity stable.\nAssistant: Resolve it before async enrichment starts.",
        sourceType: "AI_CONVERSATION",
        sourceMeta: {
          participants: [
            {
              name: "Ada",
              role: "user",
            },
          ],
          provider: "chatgpt",
          turns: [
            {
              participantIndex: 0,
              role: "user",
              sourceReference: "messages:0",
              text: "Keep participant identity stable.",
            },
          ],
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-ai-identities";
          },
        },
        backgroundScheduler: asyncTasks.schedule,
        enrichmentPipeline,
        participantIdentityResolver: {
          async resolve({ sourceMeta, userId }) {
            assert.equal(userId, "user-ai-identities");

            return {
              ...sourceMeta,
              participants: [
                {
                  ...sourceMeta.participants?.[0],
                  aliases: ["Ada"],
                  identityId: "participant-ada",
                },
              ],
              turns: [
                {
                  ...sourceMeta.turns?.[0],
                  participantIdentityId: "participant-ada",
                },
              ],
            };
          },
        },
        persistence: client,
        queuePublisher: {
          async enqueue() {},
        },
      },
    },
  );

  await asyncTasks.flushScheduledTasks();

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.deepEqual(createCalls[0]?.data.sourceMeta, {
    participantCount: 1,
    participantNames: ["Ada"],
    participantRoles: ["user"],
    participants: [
      {
        aliases: ["Ada"],
        identityId: "participant-ada",
        name: "Ada",
        role: "user",
      },
    ],
    provider: "chatgpt",
    turnCount: 1,
    turns: [
      {
        participantIdentityId: "participant-ada",
        participantIndex: 0,
        role: "user",
        sourceReference: "messages:0",
        text: "Keep participant identity stable.",
      },
    ],
  });
});

test("handleCreateInspirationRouteRequest stores the imported AI conversation transcript before queued enrichment runs", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();
  const asyncTasks = createAsyncTaskHarness();
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent:
          "User: Keep the imported transcript durable.\nAssistant: Save it before summarization starts.",
        sourceType: "AI_CONVERSATION",
        sourceUrl: "https://chatgpt.com/share/durable-thread",
        sourceMeta: {
          provider: "chatgpt",
          turnCount: 2,
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-ai-transcript";
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

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.equal(
    createCalls[0]?.data.transcript,
    "User: Keep the imported transcript durable.\nAssistant: Save it before summarization starts.",
  );
  assert.equal(
    createCalls[0]?.data.originalTranscript,
    "User: Keep the imported transcript durable.\nAssistant: Save it before summarization starts.",
  );
  assert.deepEqual(enqueuedPayloads, []);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_created",
    },
  ]);
});

test("handleCreateInspirationRouteRequest returns 201 immediately and defers ai_enrichment queue dispatch off the response path", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline, updateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  const startedAt = performance.now();
  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Capture instantly and enrich on the queue.",
        sourceType: "TEXT_NOTE",
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
    },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp_created",
    processingState: buildCreateInspirationProcessingState(),
    rawContent: "Capture instantly and enrich on the queue.",
    sourceType: "TEXT_NOTE",
  });
  assert.ok(
    elapsedMs < 500,
    `expected the response path to stay under 500ms, got ${elapsedMs.toFixed(2)}ms`,
  );
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    data: {
      userId: "user-42",
      originalRawContent: "Capture instantly and enrich on the queue.",
      rawContent: "Capture instantly and enrich on the queue.",
      sourceType: "TEXT_NOTE",
      tags: [],
      ...buildInitialInspirationEnrichmentPersistenceData(),
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
  });
  assert.equal(
    enqueuedPayloads.length,
    0,
    "queue dispatch should not block the synchronous response path",
  );
  assert.equal(
    updateCalls.length,
    0,
    "pipeline metadata refresh should stay off the synchronous response path",
  );

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_created",
    },
  ]);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.where.userId_id.userId, "user-42");
  assert.equal(updateCalls[0]?.where.userId_id.id, "insp_created");
  assert.equal(updateCalls[0]?.data.enrichmentStatus, "PENDING");
  assert.equal(
    createCalls[0]?.data.enrichmentStatus,
    INITIAL_INSPIRATION_ENRICHMENT_STATUS,
  );
  assert.equal(
    "enrichmentEnqueuedAt" in (createCalls[0]?.data ?? {}),
    false,
  );
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
  assert.equal(updateCalls[0]?.data.enrichmentLastError, null);
  assert.equal(updateCalls[0]?.data.enrichmentLastFailureReason, null);
  assert.equal(updateCalls[0]?.data.enrichmentLastFailureRetryability, null);
  assert.equal(updateCalls[0]?.data.enrichmentResumeState, null);
  assert.ok(updateCalls[0]?.data.enrichmentEnqueuedAt instanceof Date);
});

test("handleCreateInspirationRouteRequest succeeds once persistence completes even if async enrichment enqueue fails later", async () => {
  const enqueueFailure = new Error("SQS temporarily unavailable.");
  const asyncTasks = createAsyncTaskHarness();
  const events: string[] = [];
  const loggedErrors: unknown[] = [];

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Persistence should decide write success.",
        sourceType: "TEXT_NOTE",
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
          inspiration: {
            async create() {
              events.push("persistence:create");

              return {
                id: "insp_created",
                rawContent: "Persistence should decide write success.",
                sourceType: "TEXT_NOTE",
              };
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
    },
  );

  events.push("response:resolved");

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp_created",
    processingState: buildCreateInspirationProcessingState(),
    rawContent: "Persistence should decide write success.",
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(events, [
    "persistence:create",
    "scheduler:queued",
    "response:resolved",
  ]);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(events, [
    "persistence:create",
    "scheduler:queued",
    "response:resolved",
    "queue:enqueue",
    "queue:error",
  ]);
  assert.deepEqual(loggedErrors, [enqueueFailure]);
});

test("handleCreateInspirationRouteRequest keeps the default background scheduler off the response path", async () => {
  const { client } = createPersistenceClient();
  const { client: enrichmentPipeline, updateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];
  let enqueueStarted = false;

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Default scheduler should not start queue work before the response resolves.",
        sourceType: "TEXT_NOTE",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-default-scheduler";
          },
        },
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            enqueueStarted = true;
            enqueuedPayloads.push(payload);
          },
        },
      },
    },
  );

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
  assert.equal(
    enqueueStarted,
    false,
    "default background scheduling must not start queue work before the response resolves",
  );
  assert.equal(updateCalls.length, 0);

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  assert.equal(enqueueStarted, true);
  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_created",
    },
  ]);
  assert.equal(updateCalls.length, 1);
});

test("app/api/inspirations/route.ts ignores spoofed ownership fields on POST and uses the authenticated owner", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline, updateCalls: enrichmentUpdateCalls } =
    createEnrichmentPipelineClient();
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];
  const asyncTasks = createAsyncTaskHarness();

  configureCreateInspirationRouteDependencies({
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
    const { POST } = await import("../apps/web/app/api/inspirations/route.ts");
    const response = await POST(
      new Request("https://waka.app/api/inspirations", {
        method: "POST",
        body: JSON.stringify({
          rawContent: "Route handler delegation stays thin.",
          sourceType: "TEXT_NOTE",
          ownerId: "forged-owner",
          userId: "forged-user",
          tenantId: "forged-tenant",
          workspaceId: "forged-workspace",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, CREATE_INSPIRATION_ROUTE_CREATED_STATUS);
    assert.deepEqual(await response.json(), {
      id: "insp_created",
      processingState: buildCreateInspirationProcessingState(),
      rawContent: "Route handler delegation stays thin.",
      sourceType: "TEXT_NOTE",
    });

    await asyncTasks.flushScheduledTasks();

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0]?.data.userId, "user-route");
    assert.equal("ownerId" in (createCalls[0]?.data ?? {}), false);
    assert.equal("tenantId" in (createCalls[0]?.data ?? {}), false);
    assert.equal("workspaceId" in (createCalls[0]?.data ?? {}), false);
    assert.deepEqual(enqueuedPayloads, [
      {
        jobType: "ai_enrichment",
        inspirationId: "insp_created",
      },
    ]);
    assert.equal(enrichmentUpdateCalls.length, 1);
  } finally {
    configureCreateInspirationRouteDependencies(null);
  }
});

test("handleCreateInspirationRouteRequest returns 400 for invalid create payloads", async () => {
  const { client, createCalls } = createPersistenceClient();
  const { client: enrichmentPipeline } = createEnrichmentPipelineClient();

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "",
        sourceType: "TEXT_NOTE",
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
    },
  );

  assert.equal(response.status, CREATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR,
  });
  assert.equal(createCalls.length, 0);
});
