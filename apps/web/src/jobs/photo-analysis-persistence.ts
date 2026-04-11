import type { PhotoAnalysisStorageImageObject } from "./photo-analysis-storage.ts";
import {
  buildCompletedPhotoAnalysisProcessingState,
  buildProcessingPhotoAnalysisProcessingState,
  type PhotoAnalysisProcessingState,
} from "../inspirations/photo-analysis-processing-state.ts";
import { normalizePhotoAnalysisPlainText } from "./photo-analysis-text.ts";

export const PHOTO_ANALYSIS_PERSISTENCE_CAPTURE_NOT_FOUND_ERROR =
  "Photo analysis could not find the requested inspiration.";
export const PHOTO_ANALYSIS_PERSISTENCE_SOURCE_TYPE_INVALID_ERROR =
  "Photo analysis can only persist OCR results for PHOTO inspirations.";

const PHOTO_ANALYSIS_RECORD_SELECT = {
  id: true,
  rawContent: true,
  sourceMeta: true,
  sourceType: true,
  transcript: true,
} as const;

const PHOTO_ANALYSIS_UPDATE_RESULT_SELECT = {
  id: true,
} as const;

export interface PhotoAnalysisPersistenceRecord {
  id: string;
  rawContent: string;
  sourceMeta?: Record<string, unknown> | null;
  sourceType: "PHOTO" | string;
  transcript?: string | null;
}

export interface ReadPhotoAnalysisRecordArgs {
  select: typeof PHOTO_ANALYSIS_RECORD_SELECT;
  where: {
    id: string;
  };
}

export interface PersistPhotoAnalysisResultData {
  generatedDescription: string;
  ocrText: string;
  processingState: PhotoAnalysisProcessingState;
  rawContent?: string;
  sourceMeta: Record<string, unknown>;
  transcript: string;
}

export interface PersistPhotoAnalysisResultArgs {
  data: PersistPhotoAnalysisResultData;
  select: typeof PHOTO_ANALYSIS_UPDATE_RESULT_SELECT;
  where: {
    id: string;
  };
}

export interface MarkPhotoAnalysisProcessingStartedArgs {
  data: {
    processingState: PhotoAnalysisProcessingState;
  };
  select: typeof PHOTO_ANALYSIS_UPDATE_RESULT_SELECT;
  where: {
    id: string;
  };
}

export interface PhotoAnalysisPersistenceClient<
  TRecord extends PhotoAnalysisPersistenceRecord = PhotoAnalysisPersistenceRecord,
> {
  inspiration: {
    findUnique(args: ReadPhotoAnalysisRecordArgs): Promise<TRecord | null>;
    update(
      args:
        | MarkPhotoAnalysisProcessingStartedArgs
        | PersistPhotoAnalysisResultArgs,
    ): Promise<{
      id: string;
    }>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function buildReadPhotoAnalysisRecordArgs(
  inspirationId: string,
): ReadPhotoAnalysisRecordArgs {
  return {
    select: PHOTO_ANALYSIS_RECORD_SELECT,
    where: {
      id: readRequiredNonEmptyString(inspirationId, "inspirationId"),
    },
  };
}

export function buildPhotoAnalysisSourceMeta(
  existingSourceMeta: Record<string, unknown> | null | undefined,
  validatedImage: PhotoAnalysisStorageImageObject,
  extractionText: string,
): Record<string, unknown> {
  const normalizedExtractionText = normalizePhotoAnalysisPlainText(extractionText);

  return {
    ...(isRecord(existingSourceMeta) ? existingSourceMeta : {}),
    description: normalizedExtractionText,
    height: validatedImage.image.height,
    mimeType: validatedImage.image.mimeType,
    ocrText: normalizedExtractionText,
    sizeBytes: validatedImage.image.sizeBytes,
    width: validatedImage.image.width,
  };
}

function shouldPersistPhotoAnalysisRawContent(
  record: PhotoAnalysisPersistenceRecord,
  normalizedExtractionText: string,
): boolean {
  const normalizedRawContent = readRequiredNonEmptyString(
    record.rawContent,
    "record.rawContent",
  );
  const currentTranscript = readOptionalNonEmptyString(record.transcript);
  const sourceMetaFileName = isRecord(record.sourceMeta)
    ? readOptionalNonEmptyString(record.sourceMeta.fileName)
    : undefined;

  return (
    normalizedRawContent === normalizedExtractionText ||
    normalizedRawContent === currentTranscript ||
    normalizedRawContent === sourceMetaFileName
  );
}

export function buildMarkPhotoAnalysisProcessingStartedArgs(
  inspirationId: string,
): MarkPhotoAnalysisProcessingStartedArgs {
  return {
    data: {
      processingState: buildProcessingPhotoAnalysisProcessingState(),
    },
    select: PHOTO_ANALYSIS_UPDATE_RESULT_SELECT,
    where: {
      id: readRequiredNonEmptyString(inspirationId, "inspirationId"),
    },
  };
}

export function buildPersistPhotoAnalysisResultArgs(
  record: PhotoAnalysisPersistenceRecord,
  validatedImage: PhotoAnalysisStorageImageObject,
  extractionText: string,
): PersistPhotoAnalysisResultArgs {
  if (record.sourceType !== "PHOTO") {
    throw new TypeError(PHOTO_ANALYSIS_PERSISTENCE_SOURCE_TYPE_INVALID_ERROR);
  }

  const normalizedInspirationId = readRequiredNonEmptyString(
    record.id,
    "record.id",
  );
  const normalizedExtractionText = normalizePhotoAnalysisPlainText(extractionText);
  const shouldWriteRawContent = shouldPersistPhotoAnalysisRawContent(
    record,
    normalizedExtractionText,
  );

  return {
    data: {
      generatedDescription: normalizedExtractionText,
      ocrText: normalizedExtractionText,
      processingState: buildCompletedPhotoAnalysisProcessingState(),
      ...(shouldWriteRawContent
        ? { rawContent: normalizedExtractionText }
        : {}),
      sourceMeta: buildPhotoAnalysisSourceMeta(
        record.sourceMeta,
        validatedImage,
        normalizedExtractionText,
      ),
      transcript: normalizedExtractionText,
    },
    select: PHOTO_ANALYSIS_UPDATE_RESULT_SELECT,
    where: {
      id: normalizedInspirationId,
    },
  };
}

export async function persistPhotoAnalysisResult<
  TRecord extends PhotoAnalysisPersistenceRecord = PhotoAnalysisPersistenceRecord,
>(
  client: PhotoAnalysisPersistenceClient<TRecord>,
  inspirationId: string,
  validatedImage: PhotoAnalysisStorageImageObject,
  extractionText: string,
): Promise<void> {
  const record = await client.inspiration.findUnique(
    buildReadPhotoAnalysisRecordArgs(inspirationId),
  );

  if (record === null) {
    throw new Error(PHOTO_ANALYSIS_PERSISTENCE_CAPTURE_NOT_FOUND_ERROR);
  }

  await client.inspiration.update(
    buildPersistPhotoAnalysisResultArgs(
      record,
      validatedImage,
      extractionText,
    ),
  );
}

export async function markPhotoAnalysisProcessingStarted<
  TRecord extends PhotoAnalysisPersistenceRecord = PhotoAnalysisPersistenceRecord,
>(
  client: PhotoAnalysisPersistenceClient<TRecord>,
  inspirationId: string,
): Promise<void> {
  await client.inspiration.update(
    buildMarkPhotoAnalysisProcessingStartedArgs(inspirationId),
  );
}
