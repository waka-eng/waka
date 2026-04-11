export const SUPPORTED_SQS_JOB_TYPES = [
  "ai_enrichment",
  "url_import",
  "voice_transcription",
  "photo_analysis",
  "ai_conversation_import",
  "connection_analysis",
  "cluster_rebuild",
  "reflection_reembedding",
] as const;

export const JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY =
  "JOBS_DEAD_LETTER_QUEUE_URL";
export const INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY =
  "INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS";

export const AI_ENRICHMENT_FIELD_NAMES = [
  "embedding",
  "title",
  "summary",
  "tags",
  "domain",
  "mood",
  "actionability",
] as const;

export type SupportedSqsJobType = (typeof SUPPORTED_SQS_JOB_TYPES)[number];
export type AiEnrichmentFieldName =
  (typeof AI_ENRICHMENT_FIELD_NAMES)[number];

export interface S3AudioObjectReference {
  mediaUrl: string;
  storageKey: string;
}

export interface AiEnrichmentSqsJobPayload {
  jobType: "ai_enrichment";
  fieldNames?: AiEnrichmentFieldName[];
  inspirationId: string;
}

export interface UrlImportSqsJobPayload {
  jobType: "url_import";
  inspirationId: string;
  sourceUrl: string;
}

export interface VoiceTranscriptionSqsJobPayload {
  jobType: "voice_transcription";
  inspirationId: string;
  audio: S3AudioObjectReference;
}

export interface PhotoAnalysisSqsJobPayload {
  jobType: "photo_analysis";
  inspirationId: string;
  mediaUrl: string;
}

export interface AiConversationImportSqsJobPayload {
  jobType: "ai_conversation_import";
  inspirationId: string;
  shareUrl?: string;
  transcript?: string;
}

export interface ConnectionAnalysisSqsJobPayload {
  jobType: "connection_analysis";
  inspirationId: string;
  userId: string;
  maxConnections?: number;
  similarityThreshold?: number;
}

export interface ClusterRebuildSqsJobPayload {
  jobType: "cluster_rebuild";
  userId: string;
  triggerInspirationId?: string;
}

export interface ReflectionReembeddingSqsJobPayload {
  jobType: "reflection_reembedding";
  inspirationId: string;
}

export interface SqsJobPayloadMap {
  ai_enrichment: AiEnrichmentSqsJobPayload;
  url_import: UrlImportSqsJobPayload;
  voice_transcription: VoiceTranscriptionSqsJobPayload;
  photo_analysis: PhotoAnalysisSqsJobPayload;
  ai_conversation_import: AiConversationImportSqsJobPayload;
  connection_analysis: ConnectionAnalysisSqsJobPayload;
  cluster_rebuild: ClusterRebuildSqsJobPayload;
  reflection_reembedding: ReflectionReembeddingSqsJobPayload;
}

export type SupportedSqsJobPayload =
  SqsJobPayloadMap[SupportedSqsJobType];

export type SqsJobPayloadByType<
  TJobType extends SupportedSqsJobType,
> = SqsJobPayloadMap[TJobType];
