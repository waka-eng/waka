import {
  INSPIRATION_ENRICHMENT_FIELD_NAMES,
  isInspirationEnrichmentFieldName,
  type InspirationEnrichmentFieldName,
} from "./enrichment-field-metadata.ts";

export interface InspirationEnrichmentResumeCapture {
  mediaUrl: string | null;
  rawContent: string;
  sourceMeta: Record<string, unknown> | null;
  sourceUrl: string | null;
  title: string | null;
  transcript: string | null;
}

export interface InspirationEnrichmentCompletedOutputs {
  actionability?: string;
  domain?: string;
  embedding?: number[];
  mood?: string;
  summary?: string;
  tags?: string[];
  title?: string;
}

export interface InspirationEnrichmentResumeState {
  capture: InspirationEnrichmentResumeCapture;
  completedFieldNames: InspirationEnrichmentFieldName[];
  completedOutputs: InspirationEnrichmentCompletedOutputs;
  remainingFieldNames: InspirationEnrichmentFieldName[];
  updatedAt: string;
}

export interface BuildInspirationEnrichmentResumeStateInput {
  capture: InspirationEnrichmentResumeCapture;
  completedFieldNames: readonly InspirationEnrichmentFieldName[];
  completedOutputs: InspirationEnrichmentCompletedOutputs;
  remainingFieldNames: readonly InspirationEnrichmentFieldName[];
  updatedAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyRawContent(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readOptionalNullableString(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

function readOptionalNullableRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON object or null.`);
  }

  return value;
}

function readOptionalIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return value;
}

function normalizeFieldNameList(
  value: unknown,
  label: string,
): InspirationEnrichmentFieldName[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const fieldNames = new Set<InspirationEnrichmentFieldName>();

  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      !isInspirationEnrichmentFieldName(entry)
    ) {
      throw new TypeError(`${label} must contain only valid field names.`);
    }

    fieldNames.add(entry);
  }

  return INSPIRATION_ENRICHMENT_FIELD_NAMES.filter((fieldName) =>
    fieldNames.has(fieldName),
  );
}

function readOptionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided.`);
  }

  return value;
}

function readOptionalStringArray(
  value: unknown,
  label: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError(`${label} must be an array of strings when provided.`);
  }

  return [...value];
}

function readOptionalEmbedding(
  value: unknown,
  label: string,
): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    throw new TypeError(
      `${label} must be an array of finite numbers when provided.`,
    );
  }

  return [...value];
}

function normalizeCompletedOutputs(
  value: unknown,
  label: string,
): InspirationEnrichmentCompletedOutputs {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  const actionability = readOptionalString(
    value.actionability,
    `${label}.actionability`,
  );
  const domain = readOptionalString(value.domain, `${label}.domain`);
  const embedding = readOptionalEmbedding(value.embedding, `${label}.embedding`);
  const mood = readOptionalString(value.mood, `${label}.mood`);
  const summary = readOptionalString(value.summary, `${label}.summary`);
  const tags = readOptionalStringArray(value.tags, `${label}.tags`);
  const title = readOptionalString(value.title, `${label}.title`);

  return {
    ...(actionability === undefined ? {} : { actionability }),
    ...(domain === undefined ? {} : { domain }),
    ...(embedding === undefined ? {} : { embedding }),
    ...(mood === undefined ? {} : { mood }),
    ...(summary === undefined ? {} : { summary }),
    ...(tags === undefined ? {} : { tags }),
    ...(title === undefined ? {} : { title }),
  };
}

export function buildInspirationEnrichmentResumeState(
  input: BuildInspirationEnrichmentResumeStateInput,
): InspirationEnrichmentResumeState {
  const completedFieldNames = normalizeFieldNameList(
    [...input.completedFieldNames],
    "completedFieldNames",
  );
  const remainingFieldNames = normalizeFieldNameList(
    [...input.remainingFieldNames],
    "remainingFieldNames",
  );

  return {
    capture: {
      mediaUrl: input.capture.mediaUrl ?? null,
      rawContent: readNonEmptyRawContent(
        input.capture.rawContent,
        "capture.rawContent",
      ),
      sourceMeta: input.capture.sourceMeta ?? null,
      sourceUrl: input.capture.sourceUrl ?? null,
      title: input.capture.title ?? null,
      transcript: input.capture.transcript ?? null,
    },
    completedFieldNames,
    completedOutputs: {
      ...(input.completedOutputs.actionability === undefined
        ? {}
        : {
            actionability: input.completedOutputs.actionability,
          }),
      ...(input.completedOutputs.domain === undefined
        ? {}
        : {
            domain: input.completedOutputs.domain,
          }),
      ...(input.completedOutputs.embedding === undefined
        ? {}
        : {
            embedding: [...input.completedOutputs.embedding],
          }),
      ...(input.completedOutputs.mood === undefined
        ? {}
        : {
            mood: input.completedOutputs.mood,
          }),
      ...(input.completedOutputs.summary === undefined
        ? {}
        : {
            summary: input.completedOutputs.summary,
          }),
      ...(input.completedOutputs.tags === undefined
        ? {}
        : {
            tags: [...input.completedOutputs.tags],
          }),
      ...(input.completedOutputs.title === undefined
        ? {}
        : {
            title: input.completedOutputs.title,
          }),
    },
    remainingFieldNames,
    updatedAt: input.updatedAt.toISOString(),
  };
}

export function normalizeInspirationEnrichmentResumeState(
  value: unknown,
  label: string,
): InspirationEnrichmentResumeState | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  if (!isRecord(value.capture)) {
    throw new TypeError(`${label}.capture must be a JSON object.`);
  }

  return {
    capture: {
      mediaUrl: readOptionalNullableString(
        value.capture.mediaUrl,
        `${label}.capture.mediaUrl`,
      ),
      rawContent: readNonEmptyRawContent(
        value.capture.rawContent,
        `${label}.capture.rawContent`,
      ),
      sourceMeta: readOptionalNullableRecord(
        value.capture.sourceMeta,
        `${label}.capture.sourceMeta`,
      ),
      sourceUrl: readOptionalNullableString(
        value.capture.sourceUrl,
        `${label}.capture.sourceUrl`,
      ),
      title: readOptionalNullableString(
        value.capture.title,
        `${label}.capture.title`,
      ),
      transcript: readOptionalNullableString(
        value.capture.transcript,
        `${label}.capture.transcript`,
      ),
    },
    completedFieldNames: normalizeFieldNameList(
      value.completedFieldNames,
      `${label}.completedFieldNames`,
    ),
    completedOutputs: normalizeCompletedOutputs(
      value.completedOutputs,
      `${label}.completedOutputs`,
    ),
    remainingFieldNames: normalizeFieldNameList(
      value.remainingFieldNames,
      `${label}.remainingFieldNames`,
    ),
    updatedAt: readOptionalIsoTimestamp(value.updatedAt, `${label}.updatedAt`),
  };
}
