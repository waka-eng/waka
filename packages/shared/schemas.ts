import {
  AI_ENRICHMENT_FIELD_NAMES,
  SUPPORTED_SQS_JOB_TYPES,
  type AiEnrichmentFieldName,
  type AiConversationImportSqsJobPayload,
  type AiEnrichmentSqsJobPayload,
  type ClusterRebuildSqsJobPayload,
  type ConnectionAnalysisSqsJobPayload,
  type PhotoAnalysisSqsJobPayload,
  type ReflectionReembeddingSqsJobPayload,
  type S3AudioObjectReference,
  type SqsJobPayloadByType,
  type SupportedSqsJobPayload,
  type SupportedSqsJobType,
  type UrlImportSqsJobPayload,
  type VoiceTranscriptionSqsJobPayload,
} from "./types.ts";

export interface RegisteredSqsJobPayloadSchema<
  TJobType extends SupportedSqsJobType,
> {
  jobType: TJobType;
  parse(payload: unknown): SqsJobPayloadByType<TJobType>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPayloadObject(
  payload: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return payload;
}

function readRequiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function isAiEnrichmentFieldName(value: string): value is AiEnrichmentFieldName {
  return AI_ENRICHMENT_FIELD_NAMES.includes(value as AiEnrichmentFieldName);
}

function readOptionalAiEnrichmentFieldNames(
  value: unknown,
  label: string,
): AiEnrichmentFieldName[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of valid AI enrichment field names.`);
  }

  if (value.length === 0) {
    throw new TypeError(`${label} must include at least one AI enrichment field name when provided.`);
  }

  const normalizedFieldNames = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TypeError(`${label}[${index}] must be a non-empty string.`);
    }

    const normalizedEntry = entry.trim();

    if (!isAiEnrichmentFieldName(normalizedEntry)) {
      throw new TypeError(
        `${label}[${index}] must be one of: ${AI_ENRICHMENT_FIELD_NAMES.join(", ")}.`,
      );
    }

    return normalizedEntry;
  });

  return [...new Set(normalizedFieldNames)];
}

function readRequiredAbsoluteUrl(value: unknown, label: string): string {
  const normalizedValue = readRequiredNonEmptyString(value, label);

  try {
    const parsedUrl = new URL(normalizedValue);
    return parsedUrl.toString();
  } catch {
    throw new TypeError(`${label} must be a valid absolute URL.`);
  }
}

function readOptionalPositiveInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return value as number;
}

function readOptionalUnitIntervalNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError(`${label} must be a finite number between 0 and 1.`);
  }

  return value;
}

function readDeclaredJobType(
  value: unknown,
  expectedJobType: SupportedSqsJobType,
  label: string,
): void {
  if (value === undefined) {
    return;
  }

  if (value !== expectedJobType) {
    throw new TypeError(`${label} jobType must be "${expectedJobType}".`);
  }
}

function createRegisteredSqsJobPayloadSchema<
  TJobType extends SupportedSqsJobType,
>(
  jobType: TJobType,
  parsePayload: (payload: Record<string, unknown>) => SqsJobPayloadByType<TJobType>,
): RegisteredSqsJobPayloadSchema<TJobType> {
  const payloadLabel = `${jobType} SQS job payload`;

  return {
    jobType,
    parse(payload: unknown): SqsJobPayloadByType<TJobType> {
      const object = readPayloadObject(payload, payloadLabel);
      readDeclaredJobType(object.jobType, jobType, payloadLabel);
      return parsePayload(object);
    },
  };
}

function parseAiEnrichmentPayload(
  payload: Record<string, unknown>,
): AiEnrichmentSqsJobPayload {
  const fieldNames = readOptionalAiEnrichmentFieldNames(
    payload.fieldNames,
    "ai_enrichment SQS job payload fieldNames",
  );

  return {
    jobType: "ai_enrichment",
    ...(fieldNames === undefined ? {} : { fieldNames }),
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "ai_enrichment SQS job payload inspirationId",
    ),
  };
}

function parseUrlImportPayload(
  payload: Record<string, unknown>,
): UrlImportSqsJobPayload {
  return {
    jobType: "url_import",
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "url_import SQS job payload inspirationId",
    ),
    sourceUrl: readRequiredAbsoluteUrl(
      payload.sourceUrl,
      "url_import SQS job payload sourceUrl",
    ),
  };
}

function parseS3AudioObjectReference(
  value: unknown,
  label: string,
): S3AudioObjectReference {
  const audioObject = readPayloadObject(value, label);

  return {
    mediaUrl: readRequiredAbsoluteUrl(
      audioObject.mediaUrl,
      `${label}.mediaUrl`,
    ),
    storageKey: readRequiredNonEmptyString(
      audioObject.storageKey,
      `${label}.storageKey`,
    ),
  };
}

function parseVoiceTranscriptionPayload(
  payload: Record<string, unknown>,
): VoiceTranscriptionSqsJobPayload {
  return {
    jobType: "voice_transcription",
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "voice_transcription SQS job payload inspirationId",
    ),
    audio: parseS3AudioObjectReference(
      payload.audio,
      "voice_transcription SQS job payload audio",
    ),
  };
}

function parsePhotoAnalysisPayload(
  payload: Record<string, unknown>,
): PhotoAnalysisSqsJobPayload {
  return {
    jobType: "photo_analysis",
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "photo_analysis SQS job payload inspirationId",
    ),
    mediaUrl: readRequiredAbsoluteUrl(
      payload.mediaUrl,
      "photo_analysis SQS job payload mediaUrl",
    ),
  };
}

function parseAiConversationImportPayload(
  payload: Record<string, unknown>,
): AiConversationImportSqsJobPayload {
  const shareUrl =
    payload.shareUrl === undefined
      ? undefined
      : readRequiredAbsoluteUrl(
          payload.shareUrl,
          "ai_conversation_import SQS job payload shareUrl",
        );
  const transcript = readOptionalNonEmptyString(payload.transcript);

  if (!shareUrl && !transcript) {
    throw new TypeError(
      "ai_conversation_import SQS job payload must include either shareUrl or transcript.",
    );
  }

  return {
    jobType: "ai_conversation_import",
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "ai_conversation_import SQS job payload inspirationId",
    ),
    ...(shareUrl ? { shareUrl } : {}),
    ...(transcript ? { transcript } : {}),
  };
}

function parseConnectionAnalysisPayload(
  payload: Record<string, unknown>,
): ConnectionAnalysisSqsJobPayload {
  const maxConnections = readOptionalPositiveInteger(
    payload.maxConnections,
    "connection_analysis SQS job payload maxConnections",
  );
  const similarityThreshold = readOptionalUnitIntervalNumber(
    payload.similarityThreshold,
    "connection_analysis SQS job payload similarityThreshold",
  );

  return {
    jobType: "connection_analysis",
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "connection_analysis SQS job payload inspirationId",
    ),
    userId: readRequiredNonEmptyString(
      payload.userId,
      "connection_analysis SQS job payload userId",
    ),
    ...(maxConnections === undefined ? {} : { maxConnections }),
    ...(similarityThreshold === undefined ? {} : { similarityThreshold }),
  };
}

function parseClusterRebuildPayload(
  payload: Record<string, unknown>,
): ClusterRebuildSqsJobPayload {
  const triggerInspirationId = readOptionalNonEmptyString(
    payload.triggerInspirationId,
  );

  return {
    jobType: "cluster_rebuild",
    userId: readRequiredNonEmptyString(
      payload.userId,
      "cluster_rebuild SQS job payload userId",
    ),
    ...(triggerInspirationId ? { triggerInspirationId } : {}),
  };
}

function parseReflectionReembeddingPayload(
  payload: Record<string, unknown>,
): ReflectionReembeddingSqsJobPayload {
  return {
    jobType: "reflection_reembedding",
    inspirationId: readRequiredNonEmptyString(
      payload.inspirationId,
      "reflection_reembedding SQS job payload inspirationId",
    ),
  };
}

export const SQS_JOB_PAYLOAD_SCHEMAS: {
  [TJobType in SupportedSqsJobType]: RegisteredSqsJobPayloadSchema<TJobType>;
} = {
  ai_enrichment: createRegisteredSqsJobPayloadSchema(
    "ai_enrichment",
    parseAiEnrichmentPayload,
  ),
  url_import: createRegisteredSqsJobPayloadSchema(
    "url_import",
    parseUrlImportPayload,
  ),
  voice_transcription: createRegisteredSqsJobPayloadSchema(
    "voice_transcription",
    parseVoiceTranscriptionPayload,
  ),
  photo_analysis: createRegisteredSqsJobPayloadSchema(
    "photo_analysis",
    parsePhotoAnalysisPayload,
  ),
  ai_conversation_import: createRegisteredSqsJobPayloadSchema(
    "ai_conversation_import",
    parseAiConversationImportPayload,
  ),
  connection_analysis: createRegisteredSqsJobPayloadSchema(
    "connection_analysis",
    parseConnectionAnalysisPayload,
  ),
  cluster_rebuild: createRegisteredSqsJobPayloadSchema(
    "cluster_rebuild",
    parseClusterRebuildPayload,
  ),
  reflection_reembedding: createRegisteredSqsJobPayloadSchema(
    "reflection_reembedding",
    parseReflectionReembeddingPayload,
  ),
};

export function isSupportedSqsJobType(
  value: unknown,
): value is SupportedSqsJobType {
  return (
    typeof value === "string" &&
    (SUPPORTED_SQS_JOB_TYPES as readonly string[]).includes(value)
  );
}

export function parseSupportedSqsJobType(
  value: unknown,
  label = "SQS jobType",
): SupportedSqsJobType {
  if (!isSupportedSqsJobType(value)) {
    throw new TypeError(
      `${label} must be one of: ${SUPPORTED_SQS_JOB_TYPES.join(", ")}.`,
    );
  }

  return value;
}

export function parseSqsJobPayload<TJobType extends SupportedSqsJobType>(
  jobType: TJobType,
  payload: unknown,
): SqsJobPayloadByType<TJobType> {
  return SQS_JOB_PAYLOAD_SCHEMAS[jobType].parse(payload);
}

export function parseSqsJobPayloadByDiscriminant(
  payload: unknown,
): SupportedSqsJobPayload {
  const object = readPayloadObject(payload, "SQS job payload");
  const jobType = parseSupportedSqsJobType(
    object.jobType,
    "SQS job payload jobType",
  );

  return parseSqsJobPayload(jobType, object);
}
