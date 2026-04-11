import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInspirationEnrichmentFieldMetadata,
  buildPendingInspirationEnrichmentFields,
  type InspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
} from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import { INSPIRATION_ENRICHMENT_STATUS_PROCESSING } from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import type {
  ReadInspirationPersistenceArgs,
  ReadInspirationPersistenceClient,
  ReadInspirationRecord,
} from "../apps/web/src/inspirations/read-route.ts";
import {
  READ_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  READ_INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  READ_INSPIRATION_ROUTE_OK_STATUS,
  READ_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  READ_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
  buildReadInspirationPersistenceArgs,
  configureReadInspirationRouteDependencies,
  handleReadInspirationRouteRequest,
  readInspiration,
} from "../apps/web/src/inspirations/read-route.ts";

type SeededInspiration = {
  actionability?: string | null;
  audioDurationSeconds?: number | null;
  audioMimeType?: string | null;
  audioSizeBytes?: number | null;
  audioStorageKey?: string | null;
  audioStorageUrl?: string | null;
  cluster?:
    | {
        description?: string | null;
        id: string;
        label: string;
      }
    | null;
  createdAt: string;
  deletedAt?: string | null;
  domain?: string | null;
  enrichmentStatus?: string | null;
  generatedDescription?: string | null;
  id: string;
  mood?: string | null;
  parentId?: string | null;
  ocrText?: string | null;
  processingState?: Record<string, unknown> | null;
  rawContent: string;
  reflectionAnswer?: string | null;
  reflectionPrompt?: string | null;
  reflectionStatus?:
    | "ANSWERED"
    | "NOT_NEEDED"
    | "PENDING"
    | "PROMPTED"
    | "SKIPPED"
    | null;
  sourceType:
    | "AI_CONVERSATION"
    | "CLI_CONVERSATION"
    | "PHOTO"
    | "TEXT_NOTE"
    | "URL_IMPORT"
    | "VOICE_NOTE";
  sourceParentId?: string | null;
  enrichmentFields?: InspirationEnrichmentFields;
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
  updatedAt: string;
  userId: string;
};

class StubReadInspirationsPersistenceClient
  implements ReadInspirationPersistenceClient<ReadInspirationRecord>
{
  readonly findFirstCalls: ReadInspirationPersistenceArgs[] = [];
  private readonly inspirations: readonly SeededInspiration[];

  constructor(inspirations: readonly SeededInspiration[]) {
    this.inspirations = inspirations;
  }

  readonly inspiration = {
    findFirst: async (
      args: ReadInspirationPersistenceArgs,
    ): Promise<ReadInspirationRecord | null> => {
      this.findFirstCalls.push(args);

      const inspiration =
        this.inspirations.find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.userId === args.where.userId &&
            candidate.deletedAt == null,
        ) ?? null;

      if (inspiration === null) {
        return null;
      }

      const expansions = this.inspirations
        .filter(
          (candidate) =>
            candidate.userId === args.where.userId &&
            candidate.deletedAt == null &&
            candidate.parentId === inspiration.id,
        )
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime() ||
            right.id.localeCompare(left.id),
        )
        .map((expansion) => ({
          actionability: expansion.actionability,
          enrichmentFields: expansion.enrichmentFields,
          enrichmentStatus: expansion.enrichmentStatus,
          domain: expansion.domain,
          id: expansion.id,
          mood: expansion.mood,
          rawContent: expansion.rawContent,
          sourceType: expansion.sourceType,
          sourceParentId: expansion.sourceParentId,
          summary: expansion.summary,
          tags: expansion.tags,
          title: expansion.title,
          createdAt: expansion.createdAt,
          updatedAt: expansion.updatedAt,
        }));

      return {
        actionability: inspiration.actionability,
        audioDurationSeconds: inspiration.audioDurationSeconds,
        audioMimeType: inspiration.audioMimeType,
        audioSizeBytes: inspiration.audioSizeBytes,
        audioStorageKey: inspiration.audioStorageKey,
        audioStorageUrl: inspiration.audioStorageUrl,
        cluster: inspiration.cluster,
        domain: inspiration.domain,
        expansions,
        enrichmentFields: inspiration.enrichmentFields,
        enrichmentStatus: inspiration.enrichmentStatus,
        generatedDescription: inspiration.generatedDescription,
        id: inspiration.id,
        mood: inspiration.mood,
        ocrText: inspiration.ocrText,
        processingState: inspiration.processingState,
        rawContent: inspiration.rawContent,
        reflectionAnswer: inspiration.reflectionAnswer,
        reflectionPrompt: inspiration.reflectionPrompt,
        reflectionStatus: inspiration.reflectionStatus,
        sourceType: inspiration.sourceType,
        sourceParentId: inspiration.sourceParentId,
        summary: inspiration.summary,
        tags: inspiration.tags,
        title: inspiration.title,
        createdAt: inspiration.createdAt,
        updatedAt: inspiration.updatedAt,
      };
    },
  };
}

test("buildReadInspirationPersistenceArgs scopes single-record reads to the authenticated user and excludes soft-deleted rows", () => {
  assert.deepEqual(
    buildReadInspirationPersistenceArgs("user-42", "insp-1"),
    {
      where: {
        id: "insp-1",
        userId: "user-42",
        deletedAt: null,
      },
      select: {
        actionability: true,
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        cluster: {
          select: {
            description: true,
            id: true,
            label: true,
          },
        },
        generatedDescription: true,
        expansions: {
          where: {
            userId: "user-42",
            deletedAt: null,
          },
          orderBy: [{ createdAt: "desc" }],
          select: {
            actionability: true,
            domain: true,
            enrichmentFields: true,
            enrichmentStatus: true,
            id: true,
            mood: true,
            rawContent: true,
            sourceType: true,
            sourceParentId: true,
            summary: true,
            tags: true,
            title: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        domain: true,
        enrichmentFields: true,
        enrichmentStatus: true,
        id: true,
        mood: true,
        ocrText: true,
        processingState: true,
        rawContent: true,
        reflectionAnswer: true,
        reflectionPrompt: true,
        reflectionStatus: true,
        sourceType: true,
        sourceParentId: true,
        summary: true,
        tags: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    },
  );
});

test("readInspiration returns the authenticated user's record only", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-1",
      userId: "user-42",
      rawContent: "Private inspiration",
      sourceType: "TEXT_NOTE",
      enrichmentFields: buildPendingInspirationEnrichmentFields(3),
      summary: "A short summary",
      title: "Private",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
    {
      id: "insp-other",
      userId: "user-other",
      rawContent: "Other user's inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(persistence, "user-42", "insp-1");

  assert.deepEqual(inspiration, {
    id: "insp-1",
    rawContent: "Private inspiration",
    sourceType: "TEXT_NOTE",
    enrichmentFields: buildPendingInspirationEnrichmentFields(3),
    processingState: {
      fields: {
        actionability: {
          isReady: false,
          status: "PENDING",
        },
        domain: {
          isReady: false,
          status: "PENDING",
        },
        embedding: {
          isReady: false,
          status: "PENDING",
        },
        mood: {
          isReady: false,
          status: "PENDING",
        },
        summary: {
          isReady: false,
          status: "PENDING",
          value: "A short summary",
        },
        tags: {
          isReady: false,
          status: "PENDING",
        },
        title: {
          isReady: false,
          status: "PENDING",
          value: "Private",
        },
      },
      status: "PENDING",
    },
    summary: "A short summary",
    title: "Private",
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:01:00.000Z",
  });
  assert.equal("sourceParentId" in inspiration, false);
  assert.deepEqual(persistence.findFirstCalls[0]?.where, {
    id: "insp-1",
    userId: "user-42",
    deletedAt: null,
  });
});

test("readInspiration returns reflection prompt fields for inline detail rendering", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-reflection",
      userId: "user-42",
      rawContent: "A deeper note that should invite reflection.",
      reflectionPrompt:
        "What part of this idea still feels unresolved or surprising?",
      reflectionStatus: "PROMPTED",
      sourceType: "TEXT_NOTE",
      enrichmentFields: buildPendingInspirationEnrichmentFields(3),
      summary: "A deeper note that should invite reflection.",
      title: "Reflection-ready detail",
      createdAt: "2026-04-10T01:20:00.000Z",
      updatedAt: "2026-04-10T01:21:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-reflection",
  );

  assert.equal(
    inspiration.reflectionPrompt,
    "What part of this idea still feels unresolved or surprising?",
  );
  assert.equal(inspiration.reflectionStatus, "PROMPTED");
  assert.equal(inspiration.reflectionAnswer, undefined);
});

test("readInspiration returns persisted voice upload metadata for voice notes", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-voice",
      userId: "user-42",
      rawContent: "Voice note transcript",
      sourceType: "VOICE_NOTE",
      audioStorageKey: "users/user-42/voice-notes/insp-voice.webm",
      audioStorageUrl: "https://waka.app/media/insp-voice.webm",
      audioMimeType: "audio/webm",
      audioSizeBytes: 2048,
      audioDurationSeconds: 12.4,
      createdAt: "2026-04-10T01:10:00.000Z",
      updatedAt: "2026-04-10T01:11:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-voice",
  );

  assert.deepEqual(inspiration, {
    id: "insp-voice",
    rawContent: "Voice note transcript",
    sourceType: "VOICE_NOTE",
    audioStorageKey: "users/user-42/voice-notes/insp-voice.webm",
    audioStorageUrl: "https://waka.app/media/insp-voice.webm",
    audioMimeType: "audio/webm",
    audioSizeBytes: 2048,
    audioDurationSeconds: 12.4,
    createdAt: "2026-04-10T01:10:00.000Z",
    updatedAt: "2026-04-10T01:11:00.000Z",
  });
});

test("readInspiration returns dedicated OCR and generated description fields for photo captures", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-photo",
      userId: "user-42",
      rawContent: "Captured whiteboard with retry notes.",
      sourceType: "PHOTO",
      generatedDescription: "Captured whiteboard with retry notes.",
      ocrText: "Retry queue\nOffline sync",
      processingState: {
        fields: {
          generatedDescription: {
            status: "COMPLETED",
          },
          ocrText: {
            status: "COMPLETED",
          },
        },
        status: "COMPLETED",
      },
      createdAt: "2026-04-10T01:12:00.000Z",
      updatedAt: "2026-04-10T01:13:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-photo",
  );

  assert.deepEqual(inspiration, {
    generatedDescription: "Captured whiteboard with retry notes.",
    id: "insp-photo",
    ocrText: "Retry queue\nOffline sync",
    processingState: {
      fields: {
        generatedDescription: {
          isReady: true,
          status: "COMPLETED",
          value: "Captured whiteboard with retry notes.",
        },
        ocrText: {
          isReady: true,
          status: "COMPLETED",
          value: "Retry queue\nOffline sync",
        },
      },
      status: "COMPLETED",
    },
    rawContent: "Captured whiteboard with retry notes.",
    sourceType: "PHOTO",
    createdAt: "2026-04-10T01:12:00.000Z",
    updatedAt: "2026-04-10T01:13:00.000Z",
  });
});

test("handleReadInspirationRouteRequest returns persisted OCR text, generated description, and photo processing state for downstream consumers", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-photo-route",
      userId: "user-42",
      rawContent: "Captured whiteboard with retry notes.",
      sourceType: "PHOTO",
      generatedDescription: "Captured whiteboard with retry notes.",
      ocrText: "Retry queue\nOffline sync",
      processingState: {
        fields: {
          generatedDescription: {
            status: "COMPLETED",
          },
          ocrText: {
            status: "PROCESSING",
          },
        },
        status: "PROCESSING",
      },
      createdAt: "2026-04-10T01:12:00.000Z",
      updatedAt: "2026-04-10T01:13:00.000Z",
    },
  ]);

  const response = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-photo-route"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-photo-route",
      },
    },
  );

  assert.equal(response.status, READ_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    generatedDescription: "Captured whiteboard with retry notes.",
    id: "insp-photo-route",
    ocrText: "Retry queue\nOffline sync",
    processingState: {
      fields: {
        generatedDescription: {
          isReady: true,
          status: "COMPLETED",
          value: "Captured whiteboard with retry notes.",
        },
        ocrText: {
          isReady: false,
          status: "PROCESSING",
          value: "Retry queue\nOffline sync",
        },
      },
      status: "PROCESSING",
    },
    rawContent: "Captured whiteboard with retry notes.",
    sourceType: "PHOTO",
    createdAt: "2026-04-10T01:12:00.000Z",
    updatedAt: "2026-04-10T01:13:00.000Z",
  });
});

test("readInspiration returns polling-friendly AI readiness flags with any completed values already available", async () => {
  const enrichmentFields = buildPendingInspirationEnrichmentFields(3);

  enrichmentFields.embedding = buildInspirationEnrichmentFieldMetadata({
    maxAttemptCount: 3,
    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  });
  enrichmentFields.title = buildInspirationEnrichmentFieldMetadata({
    maxAttemptCount: 3,
    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  });
  enrichmentFields.summary = buildInspirationEnrichmentFieldMetadata({
    maxAttemptCount: 3,
    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  });
  enrichmentFields.tags = buildInspirationEnrichmentFieldMetadata({
    maxAttemptCount: 3,
    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  });
  enrichmentFields.domain = buildInspirationEnrichmentFieldMetadata({
    maxAttemptCount: 3,
    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  });
  enrichmentFields.actionability = buildInspirationEnrichmentFieldMetadata({
    maxAttemptCount: 3,
    status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  });

  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-poll",
      userId: "user-42",
      rawContent: "Return partial enrichment while the capture keeps processing.",
      sourceType: "TEXT_NOTE",
      enrichmentFields,
      enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
      domain: "technology",
      tags: ["capture", "polling"],
      title: "Polling-friendly capture",
      createdAt: "2026-04-10T01:05:00.000Z",
      updatedAt: "2026-04-10T01:06:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-poll",
  );

  assert.deepEqual(inspiration, {
    id: "insp-poll",
    rawContent: "Return partial enrichment while the capture keeps processing.",
    sourceType: "TEXT_NOTE",
    domain: "technology",
    enrichmentFields,
    processingState: {
      fields: {
        actionability: {
          isReady: false,
          status: "FAILED",
        },
        domain: {
          isReady: true,
          status: "COMPLETED",
          value: "technology",
        },
        embedding: {
          isReady: true,
          status: "COMPLETED",
        },
        mood: {
          isReady: false,
          status: "PENDING",
        },
        summary: {
          isReady: false,
          status: "PROCESSING",
        },
        tags: {
          isReady: true,
          status: "COMPLETED",
          value: ["capture", "polling"],
        },
        title: {
          isReady: true,
          status: "COMPLETED",
          value: "Polling-friendly capture",
        },
      },
      status: "PROCESSING",
    },
    tags: ["capture", "polling"],
    title: "Polling-friendly capture",
    createdAt: "2026-04-10T01:05:00.000Z",
    updatedAt: "2026-04-10T01:06:00.000Z",
  });
});

test("readInspiration exposes the source parent id for child inspirations", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-child",
      userId: "user-42",
      rawContent: "Nested insight",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-root",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-child",
  );

  assert.equal(inspiration.id, "insp-child");
  assert.equal(inspiration.rawContent, "Nested insight");
  assert.equal(inspiration.sourceType, "TEXT_NOTE");
  assert.equal(inspiration.sourceParentId, "insp-root");
  assert.equal(inspiration.createdAt, "2026-04-10T01:00:00.000Z");
  assert.equal(inspiration.updatedAt, "2026-04-10T01:01:00.000Z");
});

test("readInspiration includes direct expansions for parent inspirations", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-parent",
      userId: "user-42",
      rawContent: "Root inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
    {
      id: "insp-child-newer",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Most recent child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:01:00.000Z",
    },
    {
      id: "insp-child-older",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Older child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
    {
      id: "insp-grandchild",
      userId: "user-42",
      parentId: "insp-child-newer",
      rawContent: "Grandchild should not appear on the root",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:01:00.000Z",
    },
    {
      id: "insp-child-deleted",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Deleted child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      deletedAt: "2026-04-10T05:00:00.000Z",
      createdAt: "2026-04-10T02:30:00.000Z",
      updatedAt: "2026-04-10T02:31:00.000Z",
    },
    {
      id: "insp-child-other-user",
      userId: "user-other",
      parentId: "insp-parent",
      rawContent: "Cross-user child should stay private",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T03:30:00.000Z",
      updatedAt: "2026-04-10T03:31:00.000Z",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-parent",
  );

  assert.deepEqual(inspiration.expansions, [
    {
      id: "insp-child-newer",
      rawContent: "Most recent child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:01:00.000Z",
    },
    {
      id: "insp-child-older",
      rawContent: "Older child",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
  ]);
});

test("readInspiration exposes assigned cluster metadata for clustered inspirations", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      cluster: {
        description: "Related ideas around capture durability and recovery.",
        id: "cluster-capture-reliability",
        label: "Capture reliability",
      },
      createdAt: "2026-04-10T01:00:00.000Z",
      id: "insp-clustered",
      rawContent: "Grouped notes should surface together in the home feed.",
      sourceType: "TEXT_NOTE",
      updatedAt: "2026-04-10T01:01:00.000Z",
      userId: "user-42",
    },
  ]);

  const inspiration = await readInspiration(
    persistence,
    "user-42",
    "insp-clustered",
  );

  assert.deepEqual(inspiration.cluster, {
    description: "Related ideas around capture durability and recovery.",
    id: "cluster-capture-reliability",
    label: "Capture reliability",
  });
});

test("handleReadInspirationRouteRequest includes the source parent id in child inspiration responses", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-child",
      userId: "user-42",
      rawContent: "Nested insight",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-root",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
  ]);

  const response = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-child"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-child",
      },
    },
  );

  assert.equal(response.status, READ_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-child",
    rawContent: "Nested insight",
    sourceType: "TEXT_NOTE",
    sourceParentId: "insp-root",
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:01:00.000Z",
  });
});

test("handleReadInspirationRouteRequest includes expansions for parent inspirations", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-parent",
      userId: "user-42",
      rawContent: "Root inspiration",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:01:00.000Z",
    },
    {
      id: "insp-child",
      userId: "user-42",
      parentId: "insp-parent",
      rawContent: "Child inspiration",
      sourceType: "TEXT_NOTE",
      sourceParentId: "insp-parent",
      createdAt: "2026-04-10T02:00:00.000Z",
      updatedAt: "2026-04-10T02:01:00.000Z",
    },
  ]);

  const response = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-parent"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-parent",
      },
    },
  );

  assert.equal(response.status, READ_INSPIRATION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp-parent",
    rawContent: "Root inspiration",
    sourceType: "TEXT_NOTE",
    expansions: [
      {
        id: "insp-child",
        rawContent: "Child inspiration",
        sourceType: "TEXT_NOTE",
        sourceParentId: "insp-parent",
        createdAt: "2026-04-10T02:00:00.000Z",
        updatedAt: "2026-04-10T02:01:00.000Z",
      },
    ],
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:01:00.000Z",
  });
});

test("handleReadInspirationRouteRequest returns 401 when the caller is not authenticated", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([]);

  const response = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-1"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-1",
      },
    },
  );

  assert.equal(response.status, READ_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: READ_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(persistence.findFirstCalls.length, 0);
});

test("handleReadInspirationRouteRequest returns the shared not-found contract when the requested inspiration belongs to another user", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-other",
      userId: "user-other",
      rawContent: "Should remain private",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:00:00.000Z",
    },
  ]);

  const response = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-other"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-other",
      },
    },
  );

  assert.equal(response.status, READ_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: READ_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(persistence.findFirstCalls.length, 1);
  assert.deepEqual(persistence.findFirstCalls[0]?.where, {
    id: "insp-other",
    userId: "user-42",
    deletedAt: null,
  });
});

test("handleReadInspirationRouteRequest returns the same not-found contract when the requested inspiration does not exist", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([]);

  const response = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-missing"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        inspirationId: "insp-missing",
      },
    },
  );

  assert.equal(response.status, READ_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: READ_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(persistence.findFirstCalls.length, 1);
  assert.deepEqual(persistence.findFirstCalls[0]?.where, {
    id: "insp-missing",
    userId: "user-42",
    deletedAt: null,
  });
});

test("handleReadInspirationRouteRequest returns the same generic failure response for cross-user and missing reads", async () => {
  const crossUserPersistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-secret",
      userId: "user-other",
      rawContent: "Should never leak through the response contract.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T03:00:00.000Z",
      updatedAt: "2026-04-10T03:00:00.000Z",
    },
  ]);
  const missingPersistence = new StubReadInspirationsPersistenceClient([]);

  const crossUserResponse = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-secret"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: crossUserPersistence,
      },
      params: {
        inspirationId: "insp-secret",
      },
    },
  );

  const missingResponse = await handleReadInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations/insp-missing"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: missingPersistence,
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
  assert.deepEqual(crossUserPersistence.findFirstCalls[0]?.where, {
    id: "insp-secret",
    userId: "user-42",
    deletedAt: null,
  });
  assert.deepEqual(missingPersistence.findFirstCalls[0]?.where, {
    id: "insp-missing",
    userId: "user-42",
    deletedAt: null,
  });
});

test("app/api/inspirations/[id]/route.ts returns the authenticated user's own inspiration by id", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-route",
      userId: "user-route",
      rawContent: "Route handler delegation stays thin for reads.",
      sourceType: "TEXT_NOTE",
      enrichmentFields: buildPendingInspirationEnrichmentFields(3),
      summary: "Thin route summary",
      title: "Thin route",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:01:00.000Z",
    },
  ]);

  configureReadInspirationRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence,
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/[id]/route.ts");
    const response = await GET(
      new Request("https://waka.app/api/inspirations/insp-route") as never,
      {
        params: Promise.resolve({
          id: "insp-route",
        }),
      },
    );

    assert.equal(response.status, READ_INSPIRATION_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      id: "insp-route",
      rawContent: "Route handler delegation stays thin for reads.",
      sourceType: "TEXT_NOTE",
      enrichmentFields: buildPendingInspirationEnrichmentFields(3),
      processingState: {
        fields: {
          actionability: {
            isReady: false,
            status: "PENDING",
          },
          domain: {
            isReady: false,
            status: "PENDING",
          },
          embedding: {
            isReady: false,
            status: "PENDING",
          },
          mood: {
            isReady: false,
            status: "PENDING",
          },
          summary: {
            isReady: false,
            status: "PENDING",
            value: "Thin route summary",
          },
          tags: {
            isReady: false,
            status: "PENDING",
          },
          title: {
            isReady: false,
            status: "PENDING",
            value: "Thin route",
          },
        },
        status: "PENDING",
      },
      summary: "Thin route summary",
      title: "Thin route",
      createdAt: "2026-04-10T04:00:00.000Z",
      updatedAt: "2026-04-10T04:01:00.000Z",
    });
    assert.deepEqual(persistence.findFirstCalls[0]?.where, {
      id: "insp-route",
      userId: "user-route",
      deletedAt: null,
    });
  } finally {
    configureReadInspirationRouteDependencies(null);
  }
});

test("app/api/inspirations/[id]/route.ts returns persisted OCR text, generated description, and photo processing state", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-photo-app-route",
      userId: "user-route",
      rawContent: "Photo capture ready for detail rendering.",
      sourceType: "PHOTO",
      generatedDescription: "Photo capture ready for detail rendering.",
      ocrText: "Offline queue\nPersist before upload",
      processingState: {
        fields: {
          generatedDescription: {
            status: "COMPLETED",
          },
          ocrText: {
            status: "COMPLETED",
          },
        },
        status: "COMPLETED",
      },
      createdAt: "2026-04-10T04:10:00.000Z",
      updatedAt: "2026-04-10T04:11:00.000Z",
    },
  ]);

  configureReadInspirationRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence,
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/[id]/route.ts");
    const response = await GET(
      new Request("https://waka.app/api/inspirations/insp-photo-app-route") as never,
      {
        params: Promise.resolve({
          id: "insp-photo-app-route",
        }),
      },
    );

    assert.equal(response.status, READ_INSPIRATION_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      generatedDescription: "Photo capture ready for detail rendering.",
      id: "insp-photo-app-route",
      ocrText: "Offline queue\nPersist before upload",
      processingState: {
        fields: {
          generatedDescription: {
            isReady: true,
            status: "COMPLETED",
            value: "Photo capture ready for detail rendering.",
          },
          ocrText: {
            isReady: true,
            status: "COMPLETED",
            value: "Offline queue\nPersist before upload",
          },
        },
        status: "COMPLETED",
      },
      rawContent: "Photo capture ready for detail rendering.",
      sourceType: "PHOTO",
      createdAt: "2026-04-10T04:10:00.000Z",
      updatedAt: "2026-04-10T04:11:00.000Z",
    });
    assert.deepEqual(persistence.findFirstCalls[0]?.where, {
      id: "insp-photo-app-route",
      userId: "user-route",
      deletedAt: null,
    });
  } finally {
    configureReadInspirationRouteDependencies(null);
  }
});

test("app/api/inspirations/[id]/route.ts denies cross-user reads for authenticated callers", async () => {
  const persistence = new StubReadInspirationsPersistenceClient([
    {
      id: "insp-secret",
      userId: "user-other",
      rawContent: "Should remain private.",
      sourceType: "TEXT_NOTE",
      createdAt: "2026-04-10T05:00:00.000Z",
      updatedAt: "2026-04-10T05:01:00.000Z",
    },
  ]);

  configureReadInspirationRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    persistence,
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/[id]/route.ts");
    const response = await GET(
      new Request("https://waka.app/api/inspirations/insp-secret") as never,
      {
        params: Promise.resolve({
          id: "insp-secret",
        }),
      },
    );

    assert.equal(response.status, READ_INSPIRATION_ROUTE_NOT_FOUND_STATUS);
    assert.deepEqual(await response.json(), {
      error: READ_INSPIRATION_ROUTE_NOT_FOUND_ERROR,
    });
    assert.deepEqual(persistence.findFirstCalls[0]?.where, {
      id: "insp-secret",
      userId: "user-route",
      deletedAt: null,
    });
  } finally {
    configureReadInspirationRouteDependencies(null);
  }
});
