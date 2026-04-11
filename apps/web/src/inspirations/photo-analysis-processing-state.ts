import {
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  type InspirationEnrichmentFieldStatus,
} from "./enrichment-field-metadata.ts";
import {
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_PENDING,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
} from "./enrichment-pipeline.ts";

export type PhotoAnalysisProcessingStatus =
  | typeof INSPIRATION_ENRICHMENT_STATUS_PENDING
  | typeof INSPIRATION_ENRICHMENT_STATUS_PROCESSING
  | typeof INSPIRATION_ENRICHMENT_STATUS_COMPLETED;

export type PhotoAnalysisProcessingFieldStatus =
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED;

export interface PhotoAnalysisProcessingFieldState {
  status: PhotoAnalysisProcessingFieldStatus;
}

export interface PhotoAnalysisProcessingState {
  fields: {
    generatedDescription: PhotoAnalysisProcessingFieldState;
    ocrText: PhotoAnalysisProcessingFieldState;
  };
  status: PhotoAnalysisProcessingStatus;
}

function buildPhotoAnalysisProcessingFieldState(
  status: InspirationEnrichmentFieldStatus,
): PhotoAnalysisProcessingFieldState {
  if (
    status !== INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING &&
    status !== INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING &&
    status !== INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED
  ) {
    throw new TypeError(
      `Photo analysis processing fields do not support the ${status} status.`,
    );
  }

  return {
    status,
  };
}

function buildPhotoAnalysisProcessingState(
  status: PhotoAnalysisProcessingStatus,
  fieldStatus: PhotoAnalysisProcessingFieldStatus,
): PhotoAnalysisProcessingState {
  return {
    fields: {
      generatedDescription: buildPhotoAnalysisProcessingFieldState(fieldStatus),
      ocrText: buildPhotoAnalysisProcessingFieldState(fieldStatus),
    },
    status,
  };
}

export function buildPendingPhotoAnalysisProcessingState(): PhotoAnalysisProcessingState {
  return buildPhotoAnalysisProcessingState(
    INSPIRATION_ENRICHMENT_STATUS_PENDING,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
  );
}

export function buildProcessingPhotoAnalysisProcessingState(): PhotoAnalysisProcessingState {
  return buildPhotoAnalysisProcessingState(
    INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
}

export function buildCompletedPhotoAnalysisProcessingState(): PhotoAnalysisProcessingState {
  return buildPhotoAnalysisProcessingState(
    INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
}
