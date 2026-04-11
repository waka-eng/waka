import type { CreateInspirationRequestBody } from "../../apps/web/src/inspirations/create-route.ts";
import type {
  AiEnrichmentFieldName,
  AiEnrichmentSqsJobPayload,
  ClusterRebuildSqsJobPayload,
  ConnectionAnalysisSqsJobPayload,
} from "../../packages/shared/types.ts";

export const EXPECTED_ENRICHMENT_LOAD_SOURCE_TYPES = [
  "TEXT_NOTE",
  "CLI_CONVERSATION",
  "URL_IMPORT",
  "VOICE_NOTE",
  "PHOTO",
  "AI_CONVERSATION",
] as const;

export type ExpectedEnrichmentLoadSourceType =
  (typeof EXPECTED_ENRICHMENT_LOAD_SOURCE_TYPES)[number];

export interface ExpectedEnrichmentSemanticGroupDefinition {
  key: string;
  keywords: readonly string[];
  label: string;
  summary: string;
}

export const DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS = [
  {
    key: "capture-reliability",
    label: "Capture Reliability",
    summary:
      "Retries, offline durability, and never losing a thought once the user hits save.",
    keywords: ["offline queue", "retry policy", "durable save", "last-write-wins"],
  },
  {
    key: "semantic-clustering",
    label: "Semantic Clustering",
    summary:
      "Embeddings, similarity search, and DBSCAN grouping of related inspirations.",
    keywords: ["pgvector", "DBSCAN", "semantic neighbors", "cluster rebuild"],
  },
  {
    key: "cross-surface-capture",
    label: "Cross-Surface Capture",
    summary:
      "Capturing from web, CLI, voice, photos, and imported AI conversations.",
    keywords: ["capture bar", "CLI import", "voice note", "photo OCR"],
  },
  {
    key: "adaptive-reflection",
    label: "Adaptive Reflection",
    summary:
      "Post-save reflection prompts, contextual follow-up questions, and answer-driven re-embedding.",
    keywords: [
      "reflection prompt",
      "post-save follow-up",
      "answer re-embedding",
      "non-blocking enrichment",
    ],
  },
  {
    key: "shareable-discoveries",
    label: "Shareable Discoveries",
    summary:
      "Connections, discoveries feed updates, and shareable cards that expose meaningful insights.",
    keywords: [
      "discoveries feed",
      "connection explanation",
      "share card",
      "cluster changes",
    ],
  },
] as const satisfies readonly ExpectedEnrichmentSemanticGroupDefinition[];

export const EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS = [
  "embedding",
  "title",
  "summary",
  "tags",
  "domain",
  "mood",
  "actionability",
] as const satisfies readonly AiEnrichmentFieldName[];

export const EXPECTED_ENRICHMENT_LOAD_AI_FIELDS =
  EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS;

export const DEFAULT_EXPECTED_ENRICHMENT_CAPTURE_VOLUME = 50;
export const DEFAULT_END_TO_END_ENRICHMENT_CAPTURE_VOLUME =
  DEFAULT_EXPECTED_ENRICHMENT_CAPTURE_VOLUME;
export const DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_TRIGGER_EVERY = 5;
export const DEFAULT_EXPECTED_ENRICHMENT_CONNECTION_LIMIT = 5;
export const DEFAULT_EXPECTED_ENRICHMENT_SIMILARITY_THRESHOLD = 0.78;
export const DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_EPSILON = 0.25;
export const DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_MIN_SAMPLES = 3;
export const DEFAULT_EXPECTED_ENRICHMENT_BASE_URL = "https://fixtures.waka.test";
export const DEFAULT_EXPECTED_ENRICHMENT_USER_ID = "user_expected_load";
export const DEFAULT_EXPECTED_ENRICHMENT_INGEST_START_DELAY_MS = 1_000;
export const DEFAULT_EXPECTED_ENRICHMENT_AI_FIELDS_COMPLETION_DELAY_MS = 2_000;

export interface ExpectedEnrichmentLoadFixtureOptions {
  baseCapturedAt?: Date | string;
  baseUrl?: string;
  captureVolume?: number;
  clusterEpsilon?: number;
  clusterMinSamples?: number;
  clusterTriggerEvery?: number;
  connectionLimit?: number;
  semanticGroups?: readonly ExpectedEnrichmentSemanticGroupDefinition[];
  similarityThreshold?: number;
  sourceTypeSequence?: readonly ExpectedEnrichmentLoadSourceType[];
  userId?: string;
}

export interface ResolvedExpectedEnrichmentLoadFixtureOptions {
  baseCapturedAtIso: string;
  baseUrl: string;
  captureVolume: number;
  clusterEpsilon: number;
  clusterMinSamples: number;
  clusterTriggerEvery: number;
  connectionLimit: number;
  semanticGroups: readonly ExpectedEnrichmentSemanticGroupDefinition[];
  similarityThreshold: number;
  sourceTypeSequence: readonly ExpectedEnrichmentLoadSourceType[];
  userId: string;
}

export interface ExpectedEnrichmentLoadCaptureJobs {
  aiEnrichment: AiEnrichmentSqsJobPayload;
  clusterRebuild?: ClusterRebuildSqsJobPayload;
  connectionAnalysis: ConnectionAnalysisSqsJobPayload;
}

export interface ExpectedEnrichmentLoadCaptureExpectation {
  aiFieldNames: readonly AiEnrichmentFieldName[];
  clusterRebuildOrdinal?: number;
  connectionCandidateCount: number;
  connectionCandidateIds: readonly string[];
  expectedFinalSemanticGroupSize: number;
  requiredRequestFields: readonly (keyof CreateInspirationRequestBody)[];
  semanticGroupCaptureOrdinal: number;
  similarityThreshold: number;
  triggersClusterRebuild: boolean;
}

export interface ExpectedEnrichmentLoadCaptureTimestamps {
  aiFieldsCompletedAt: string;
  captureStartedAt: string;
  ingestStartedAt: string;
}

export interface ExpectedEnrichmentLoadCaptureRecord {
  batchOrdinal: number;
  capturedAt: string;
  captureOrdinal: number;
  expected: ExpectedEnrichmentLoadCaptureExpectation;
  id: string;
  jobs: ExpectedEnrichmentLoadCaptureJobs;
  request: CreateInspirationRequestBody;
  semanticGroup: ExpectedEnrichmentSemanticGroupDefinition & {
    captureOrdinal: number;
  };
  sourceType: ExpectedEnrichmentLoadSourceType;
  timestamps: ExpectedEnrichmentLoadCaptureTimestamps;
}

export interface ExpectedEnrichmentLoadFixtureSummary {
  aiEnrichmentJobCount: number;
  captureVolume: number;
  clusterRebuildTriggerCaptureIds: readonly string[];
  clusterRebuildTriggerOrdinals: readonly number[];
  clusterableCaptureCount: number;
  clusterableSemanticGroupKeys: readonly string[];
  connectionAnalysisJobCount: number;
  semanticGroupBreakdown: Record<string, number>;
  sourceTypeBreakdown: Record<ExpectedEnrichmentLoadSourceType, number>;
}

export interface ExpectedEnrichmentLoadFixture {
  captures: readonly ExpectedEnrichmentLoadCaptureRecord[];
  options: ResolvedExpectedEnrichmentLoadFixtureOptions;
  summary: ExpectedEnrichmentLoadFixtureSummary;
}

interface InternalCaptureSeed {
  batchOrdinal: number;
  capturedAt: string;
  captureOrdinal: number;
  id: string;
  request: CreateInspirationRequestBody;
  semanticGroup: ExpectedEnrichmentSemanticGroupDefinition;
  semanticGroupCaptureOrdinal: number;
  sourceType: ExpectedEnrichmentLoadSourceType;
  timestamps: ExpectedEnrichmentLoadCaptureTimestamps;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return value;
}

function assertUnitInterval(value: number, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1.`);
  }

  return value;
}

function assertPositiveFiniteNumber(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }

  return value;
}

function assertNonEmptyTrimmedString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readIsoTimestamp(value: Date | string | undefined): string {
  const timestamp =
    value === undefined ? new Date("2026-04-10T00:00:00.000Z") : new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError("baseCapturedAt must be a valid Date or ISO timestamp.");
  }

  return timestamp.toISOString();
}

function readBaseUrl(value: string | undefined): string {
  const normalizedValue = value?.trim() ?? DEFAULT_EXPECTED_ENRICHMENT_BASE_URL;

  try {
    return new URL(normalizedValue).toString().replace(/\/$/, "");
  } catch {
    throw new TypeError("baseUrl must be a valid absolute URL.");
  }
}

function resolveSemanticGroups(
  value: readonly ExpectedEnrichmentSemanticGroupDefinition[] | undefined,
): readonly ExpectedEnrichmentSemanticGroupDefinition[] {
  const semanticGroups = value ?? DEFAULT_EXPECTED_ENRICHMENT_SEMANTIC_GROUPS;

  if (semanticGroups.length === 0) {
    throw new RangeError("semanticGroups must contain at least one semantic group.");
  }

  const seenKeys = new Set<string>();

  return semanticGroups.map((group, index) => {
    const key = assertNonEmptyTrimmedString(
      group.key,
      `semanticGroups[${index}] key`,
    );
    const label = assertNonEmptyTrimmedString(
      group.label,
      `semanticGroups[${index}] label`,
    );
    const summary = assertNonEmptyTrimmedString(
      group.summary,
      `semanticGroups[${index}] summary`,
    );

    if (seenKeys.has(key)) {
      throw new RangeError(`semanticGroups[${index}] key "${key}" must be unique.`);
    }

    seenKeys.add(key);

    const keywords = group.keywords.map((keyword, keywordIndex) =>
      assertNonEmptyTrimmedString(
        keyword,
        `semanticGroups[${index}] keywords[${keywordIndex}]`,
      ),
    );

    if (keywords.length === 0) {
      throw new RangeError(
        `semanticGroups[${index}] must include at least one keyword.`,
      );
    }

    return {
      key,
      keywords,
      label,
      summary,
    };
  });
}

function resolveSourceTypeSequence(
  value: readonly ExpectedEnrichmentLoadSourceType[] | undefined,
): readonly ExpectedEnrichmentLoadSourceType[] {
  const sourceTypeSequence = value ?? EXPECTED_ENRICHMENT_LOAD_SOURCE_TYPES;

  if (sourceTypeSequence.length === 0) {
    throw new RangeError(
      "sourceTypeSequence must contain at least one supported source type.",
    );
  }

  return sourceTypeSequence.map((sourceType, index) => {
    if (!EXPECTED_ENRICHMENT_LOAD_SOURCE_TYPES.includes(sourceType)) {
      throw new TypeError(
        `sourceTypeSequence[${index}] must be one of: ${EXPECTED_ENRICHMENT_LOAD_SOURCE_TYPES.join(", ")}.`,
      );
    }

    return sourceType;
  });
}

function resolveOptions(
  options: ExpectedEnrichmentLoadFixtureOptions = {},
): ResolvedExpectedEnrichmentLoadFixtureOptions {
  return {
    baseCapturedAtIso: readIsoTimestamp(options.baseCapturedAt),
    baseUrl: readBaseUrl(options.baseUrl),
    captureVolume: assertPositiveInteger(
      options.captureVolume ?? DEFAULT_EXPECTED_ENRICHMENT_CAPTURE_VOLUME,
      "captureVolume",
    ),
    clusterEpsilon: assertPositiveFiniteNumber(
      options.clusterEpsilon ?? DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_EPSILON,
      "clusterEpsilon",
    ),
    clusterMinSamples: assertPositiveInteger(
      options.clusterMinSamples ?? DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_MIN_SAMPLES,
      "clusterMinSamples",
    ),
    clusterTriggerEvery: assertPositiveInteger(
      options.clusterTriggerEvery ??
        DEFAULT_EXPECTED_ENRICHMENT_CLUSTER_TRIGGER_EVERY,
      "clusterTriggerEvery",
    ),
    connectionLimit: assertPositiveInteger(
      options.connectionLimit ?? DEFAULT_EXPECTED_ENRICHMENT_CONNECTION_LIMIT,
      "connectionLimit",
    ),
    semanticGroups: resolveSemanticGroups(options.semanticGroups),
    similarityThreshold: assertUnitInterval(
      options.similarityThreshold ??
        DEFAULT_EXPECTED_ENRICHMENT_SIMILARITY_THRESHOLD,
      "similarityThreshold",
    ),
    sourceTypeSequence: resolveSourceTypeSequence(options.sourceTypeSequence),
    userId: assertNonEmptyTrimmedString(
      options.userId ?? DEFAULT_EXPECTED_ENRICHMENT_USER_ID,
      "userId",
    ),
  };
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCaptureId(semanticGroupKey: string, captureOrdinal: number): string {
  return `insp_${toKebabCase(semanticGroupKey)}_${captureOrdinal.toString().padStart(3, "0")}`;
}

function buildCapturedAt(baseCapturedAtIso: string, captureOrdinal: number): string {
  const timestamp = new Date(baseCapturedAtIso);
  timestamp.setMinutes(timestamp.getMinutes() + captureOrdinal - 1);
  return timestamp.toISOString();
}

function offsetIsoTimestamp(baseIso: string, offsetMs: number): string {
  const timestamp = new Date(baseIso);
  timestamp.setMilliseconds(timestamp.getMilliseconds() + offsetMs);
  return timestamp.toISOString();
}

function buildCaptureTimestamps(
  capturedAt: string,
): ExpectedEnrichmentLoadCaptureTimestamps {
  return {
    aiFieldsCompletedAt: offsetIsoTimestamp(
      capturedAt,
      DEFAULT_EXPECTED_ENRICHMENT_AI_FIELDS_COMPLETION_DELAY_MS,
    ),
    captureStartedAt: capturedAt,
    ingestStartedAt: offsetIsoTimestamp(
      capturedAt,
      DEFAULT_EXPECTED_ENRICHMENT_INGEST_START_DELAY_MS,
    ),
  };
}

function buildRequiredRequestFields(
  sourceType: ExpectedEnrichmentLoadSourceType,
): readonly (keyof CreateInspirationRequestBody)[] {
  switch (sourceType) {
    case "URL_IMPORT":
      return ["rawContent", "sourceMeta", "sourceType", "sourceUrl"];
    case "VOICE_NOTE":
      return [
        "audioDurationSeconds",
        "audioMimeType",
        "audioSizeBytes",
        "audioStorageKey",
        "audioStorageUrl",
        "mediaUrl",
        "rawContent",
        "sourceMeta",
        "sourceType",
        "transcript",
      ];
    case "PHOTO":
      return ["mediaUrl", "rawContent", "sourceMeta", "sourceType", "transcript"];
    case "AI_CONVERSATION":
      return [
        "rawContent",
        "sourceMeta",
        "sourceType",
        "sourceUrl",
        "transcript",
      ];
    case "CLI_CONVERSATION":
    case "TEXT_NOTE":
      return ["rawContent", "sourceMeta", "sourceType"];
  }
}

function buildSharedSourceMeta(args: {
  batchOrdinal: number;
  captureOrdinal: number;
  capturedAt: string;
  semanticGroup: ExpectedEnrichmentSemanticGroupDefinition;
  semanticGroupCaptureOrdinal: number;
  sourceType: ExpectedEnrichmentLoadSourceType;
}) {
  return {
    batchOrdinal: args.batchOrdinal,
    captureOrdinal: args.captureOrdinal,
    capturedAt: args.capturedAt,
    expectedLoad: true,
    semanticGroupCaptureOrdinal: args.semanticGroupCaptureOrdinal,
    semanticGroupKey: args.semanticGroup.key,
    semanticGroupLabel: args.semanticGroup.label,
    sourceSurface: args.sourceType,
  };
}

function buildTextCaptureRequest(args: {
  batchOrdinal: number;
  captureOrdinal: number;
  capturedAt: string;
  semanticGroup: ExpectedEnrichmentSemanticGroupDefinition;
  semanticGroupCaptureOrdinal: number;
  sourceType: ExpectedEnrichmentLoadSourceType;
  baseUrl: string;
}): CreateInspirationRequestBody {
  const primaryKeyword = args.semanticGroup.keywords[0]!;
  const secondaryKeyword =
    args.semanticGroup.keywords[1] ?? args.semanticGroup.keywords[0]!;
  const tertiaryKeyword =
    args.semanticGroup.keywords[2] ??
    args.semanticGroup.keywords[args.semanticGroup.keywords.length - 1]!;
  const sharedSourceMeta = buildSharedSourceMeta(args);

  switch (args.sourceType) {
    case "TEXT_NOTE":
      return {
        rawContent: [
          `Keep ${primaryKeyword} visible even when ${secondaryKeyword} is still pending.`,
          `This ${args.semanticGroup.label.toLowerCase()} note should survive every reconnect without losing ${tertiaryKeyword}.`,
        ].join(" "),
        sourceMeta: {
          ...sharedSourceMeta,
          entryPoint: "web-capture-bar",
        },
        sourceType: "TEXT_NOTE",
      };
    case "CLI_CONVERSATION":
      return {
        rawContent: [
          `CLI capture ${args.captureOrdinal}: route ${primaryKeyword} work through ${secondaryKeyword}.`,
          `The terminal flow should preserve ${tertiaryKeyword} after auth and save.`,
        ].join(" "),
        sourceMeta: {
          ...sharedSourceMeta,
          entryPoint: "waka-cli",
          terminal: "zsh",
        },
        sourceType: "CLI_CONVERSATION",
      };
    case "URL_IMPORT": {
      const sourceUrl = `${args.baseUrl}/articles/${toKebabCase(args.semanticGroup.key)}/${args.captureOrdinal}`;
      return {
        rawContent: `Worth revisiting for ${args.semanticGroup.label}: ${sourceUrl}`,
        sourceMeta: {
          ...sharedSourceMeta,
          domain: new URL(sourceUrl).hostname,
          ogTitle: `${args.semanticGroup.label} article ${args.semanticGroupCaptureOrdinal}`,
        },
        sourceType: "URL_IMPORT",
        sourceUrl,
      };
    }
    case "VOICE_NOTE": {
      const mediaUrl = `${args.baseUrl}/media/voice/${toKebabCase(args.semanticGroup.key)}/${args.captureOrdinal}.m4a`;
      return {
        audioDurationSeconds: 42 + args.semanticGroupCaptureOrdinal,
        audioMimeType: "audio/mp4",
        audioSizeBytes: 32_000 + args.captureOrdinal * 128,
        audioStorageKey: `voice/${toKebabCase(args.semanticGroup.key)}/${args.captureOrdinal}.m4a`,
        audioStorageUrl: mediaUrl,
        mediaUrl,
        rawContent: `Voice memo on ${args.semanticGroup.label} insight ${args.semanticGroupCaptureOrdinal}.`,
        sourceMeta: {
          ...sharedSourceMeta,
          recordingDevice: "iphone-mic",
        },
        sourceType: "VOICE_NOTE",
        transcript: [
          `Voice transcript about ${primaryKeyword}, ${secondaryKeyword}, and ${tertiaryKeyword}.`,
          `It should flow into the async enrichment queue without blocking capture.`,
        ].join(" "),
      };
    }
    case "PHOTO": {
      const mediaUrl = `${args.baseUrl}/media/photos/${toKebabCase(args.semanticGroup.key)}/${args.captureOrdinal}.jpg`;
      return {
        mediaUrl,
        rawContent: `Photo capture of ${args.semanticGroup.label} whiteboard notes ${args.semanticGroupCaptureOrdinal}.`,
        sourceMeta: {
          ...sharedSourceMeta,
          imageHeight: 1200,
          imageWidth: 1600,
          ocrConfidence: 0.98,
        },
        sourceType: "PHOTO",
        transcript: `Whiteboard OCR mentions ${primaryKeyword}, ${secondaryKeyword}, and ${tertiaryKeyword}.`,
      };
    }
    case "AI_CONVERSATION": {
      const sourceUrl = `https://chatgpt.com/share/${toKebabCase(args.semanticGroup.key)}-${args.captureOrdinal}`;
      return {
        rawContent: [
          `AI conversation about ${args.semanticGroup.label}.`,
          `The discussion connected ${primaryKeyword} with ${secondaryKeyword}.`,
        ].join(" "),
        sourceMeta: {
          ...sharedSourceMeta,
          provider: "chatgpt",
          turnCount: 6 + args.semanticGroupCaptureOrdinal,
        },
        sourceType: "AI_CONVERSATION",
        sourceUrl,
        transcript: [
          `User: How do we keep ${primaryKeyword} trustworthy?`,
          `Assistant: Thread ${secondaryKeyword} through the queue and resurface ${tertiaryKeyword} later.`,
        ].join(" "),
      };
    }
  }
}

function buildSeeds(
  options: ResolvedExpectedEnrichmentLoadFixtureOptions,
): readonly InternalCaptureSeed[] {
  return Array.from({ length: options.captureVolume }, (_, index) => {
    const captureOrdinal = index + 1;
    const semanticGroup = options.semanticGroups[index % options.semanticGroups.length]!;
    const semanticGroupCaptureOrdinal =
      Math.floor(index / options.semanticGroups.length) + 1;
    const sourceType =
      options.sourceTypeSequence[index % options.sourceTypeSequence.length]!;
    const batchOrdinal = Math.floor(index / options.clusterTriggerEvery) + 1;
    const capturedAt = buildCapturedAt(options.baseCapturedAtIso, captureOrdinal);
    const id = buildCaptureId(semanticGroup.key, captureOrdinal);
    const timestamps = buildCaptureTimestamps(capturedAt);

    return {
      batchOrdinal,
      capturedAt,
      captureOrdinal,
      id,
      request: buildTextCaptureRequest({
        baseUrl: options.baseUrl,
        batchOrdinal,
        captureOrdinal,
        capturedAt,
        semanticGroup,
        semanticGroupCaptureOrdinal,
        sourceType,
      }),
      semanticGroup,
      semanticGroupCaptureOrdinal,
      sourceType,
      timestamps,
    } satisfies InternalCaptureSeed;
  });
}

function buildFixtureSummary(args: {
  captures: readonly ExpectedEnrichmentLoadCaptureRecord[];
  options: ResolvedExpectedEnrichmentLoadFixtureOptions;
}): ExpectedEnrichmentLoadFixtureSummary {
  const semanticGroupBreakdown = args.captures.reduce<Record<string, number>>(
    (counts, capture) => ({
      ...counts,
      [capture.semanticGroup.key]: (counts[capture.semanticGroup.key] ?? 0) + 1,
    }),
    Object.fromEntries(
      args.options.semanticGroups.map((group) => [group.key, 0]),
    ) as Record<string, number>,
  );
  const clusterableSemanticGroupKeys = args.options.semanticGroups
    .filter(
      (group) =>
        (semanticGroupBreakdown[group.key] ?? 0) >= args.options.clusterMinSamples,
    )
    .map((group) => group.key);

  return {
    aiEnrichmentJobCount: args.captures.length,
    captureVolume: args.captures.length,
    clusterRebuildTriggerCaptureIds: args.captures
      .filter((capture) => capture.expected.triggersClusterRebuild)
      .map((capture) => capture.id),
    clusterRebuildTriggerOrdinals: args.captures
      .filter((capture) => capture.expected.triggersClusterRebuild)
      .map((capture) => capture.captureOrdinal),
    clusterableCaptureCount: clusterableSemanticGroupKeys.reduce(
      (total, key) => total + (semanticGroupBreakdown[key] ?? 0),
      0,
    ),
    clusterableSemanticGroupKeys,
    connectionAnalysisJobCount: args.captures.length,
    semanticGroupBreakdown,
    sourceTypeBreakdown: args.captures.reduce<
      Record<ExpectedEnrichmentLoadSourceType, number>
    >(
      (counts, capture) => ({
        ...counts,
        [capture.sourceType]: (counts[capture.sourceType] ?? 0) + 1,
      }),
      Object.fromEntries(
        EXPECTED_ENRICHMENT_LOAD_SOURCE_TYPES.map((sourceType) => [sourceType, 0]),
      ) as Record<ExpectedEnrichmentLoadSourceType, number>,
    ),
  };
}

export function createExpectedEnrichmentLoadFixture(
  options: ExpectedEnrichmentLoadFixtureOptions = {},
): ExpectedEnrichmentLoadFixture {
  const resolvedOptions = resolveOptions(options);
  const seeds = buildSeeds(resolvedOptions);
  const finalSemanticGroupSizes = seeds.reduce<Record<string, number>>(
    (counts, seed) => ({
      ...counts,
      [seed.semanticGroup.key]: (counts[seed.semanticGroup.key] ?? 0) + 1,
    }),
    Object.fromEntries(
      resolvedOptions.semanticGroups.map((group) => [group.key, 0]),
    ) as Record<string, number>,
  );
  const captureIdsBySemanticGroup = new Map<string, string[]>();

  const captures = seeds.map((seed) => {
    const priorRelatedCaptureIds = [
      ...(captureIdsBySemanticGroup.get(seed.semanticGroup.key) ?? []),
    ];
    const connectionCandidateIds = priorRelatedCaptureIds
      .slice(-resolvedOptions.connectionLimit)
      .reverse();
    const triggersClusterRebuild =
      seed.captureOrdinal % resolvedOptions.clusterTriggerEvery === 0;
    const clusterRebuildOrdinal = triggersClusterRebuild
      ? Math.floor(seed.captureOrdinal / resolvedOptions.clusterTriggerEvery)
      : undefined;

    captureIdsBySemanticGroup.set(seed.semanticGroup.key, [
      ...priorRelatedCaptureIds,
      seed.id,
    ]);

    const jobs = {
      aiEnrichment: {
        jobType: "ai_enrichment",
        inspirationId: seed.id,
      },
      ...(triggersClusterRebuild
        ? {
            clusterRebuild: {
              jobType: "cluster_rebuild",
              triggerInspirationId: seed.id,
              userId: resolvedOptions.userId,
            } satisfies ClusterRebuildSqsJobPayload,
          }
        : {}),
      connectionAnalysis: {
        inspirationId: seed.id,
        jobType: "connection_analysis",
        maxConnections: resolvedOptions.connectionLimit,
        similarityThreshold: resolvedOptions.similarityThreshold,
        userId: resolvedOptions.userId,
      },
    } satisfies ExpectedEnrichmentLoadCaptureJobs;

    return {
      batchOrdinal: seed.batchOrdinal,
      capturedAt: seed.capturedAt,
      captureOrdinal: seed.captureOrdinal,
      expected: {
        aiFieldNames: EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
        ...(clusterRebuildOrdinal === undefined ? {} : { clusterRebuildOrdinal }),
        connectionCandidateCount: connectionCandidateIds.length,
        connectionCandidateIds,
        expectedFinalSemanticGroupSize:
          finalSemanticGroupSizes[seed.semanticGroup.key] ?? 0,
        requiredRequestFields: buildRequiredRequestFields(seed.sourceType),
        semanticGroupCaptureOrdinal: seed.semanticGroupCaptureOrdinal,
        similarityThreshold: resolvedOptions.similarityThreshold,
        triggersClusterRebuild,
      },
      id: seed.id,
      jobs,
      request: {
        ...seed.request,
        sourceMeta: {
          ...seed.request.sourceMeta,
          userId: resolvedOptions.userId,
        },
      },
      semanticGroup: {
        ...seed.semanticGroup,
        captureOrdinal: seed.semanticGroupCaptureOrdinal,
      },
      sourceType: seed.sourceType,
      timestamps: seed.timestamps,
    } satisfies ExpectedEnrichmentLoadCaptureRecord;
  });

  return {
    captures,
    options: resolvedOptions,
    summary: buildFixtureSummary({
      captures,
      options: resolvedOptions,
    }),
  };
}

export const createEndToEndEnrichmentExpectedLoadFixture =
  createExpectedEnrichmentLoadFixture;
export const generateExpectedEnrichmentLoadFixture =
  createExpectedEnrichmentLoadFixture;
