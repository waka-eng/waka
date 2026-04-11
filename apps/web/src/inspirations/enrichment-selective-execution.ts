import {
  INSPIRATION_ENRICHMENT_FIELD_NAMES,
  normalizeInspirationEnrichmentFields,
  type InspirationEnrichmentFieldName,
  type InspirationEnrichmentFields,
} from "./enrichment-field-metadata.ts";
import {
  buildInspirationEnrichmentResumeState,
  normalizeInspirationEnrichmentResumeState,
  type InspirationEnrichmentCompletedOutputs,
  type InspirationEnrichmentResumeCapture,
  type InspirationEnrichmentResumeState,
} from "./enrichment-resume-state.ts";

export interface InspirationEnrichmentExecutionRecord {
  actionability?: string | null;
  domain?: string | null;
  embedding?: number[] | null;
  enrichmentFields?: unknown;
  enrichmentResumeState?: unknown;
  id: string;
  mediaUrl?: string | null;
  mood?: string | null;
  rawContent: string;
  sourceMeta?: Record<string, unknown> | null;
  sourceUrl?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
  transcript?: string | null;
}

export interface InspirationEnrichmentExecutionPlan {
  capture: InspirationEnrichmentResumeCapture;
  completedFieldNames: InspirationEnrichmentFieldName[];
  completedOutputs: InspirationEnrichmentCompletedOutputs;
  existingFields?: InspirationEnrichmentFields;
  fieldNamesToProcess: InspirationEnrichmentFieldName[];
  remainingFieldNames: InspirationEnrichmentFieldName[];
  resumeState?: InspirationEnrichmentResumeState;
}

export interface ResolveInspirationEnrichmentExecutionPlanOptions {
  forceFullReprocessing?: boolean;
  requestedFieldNames?: readonly InspirationEnrichmentFieldName[];
}

function createInspirationEnrichmentResumeCapture(
  inspiration: InspirationEnrichmentExecutionRecord,
): InspirationEnrichmentResumeCapture {
  return {
    mediaUrl: inspiration.mediaUrl ?? null,
    rawContent: inspiration.rawContent,
    sourceMeta: inspiration.sourceMeta ?? null,
    sourceUrl: inspiration.sourceUrl ?? null,
    title: inspiration.title ?? null,
    transcript: inspiration.transcript ?? null,
  };
}

function resolveOrderedFieldNames(
  fieldNames: Iterable<InspirationEnrichmentFieldName>,
): InspirationEnrichmentFieldName[] {
  const includedFieldNames = new Set(fieldNames);

  return INSPIRATION_ENRICHMENT_FIELD_NAMES.filter((fieldName) =>
    includedFieldNames.has(fieldName),
  );
}

function hasCompletedEmbeddingOutput(
  outputs: InspirationEnrichmentCompletedOutputs,
): boolean {
  return (
    Array.isArray(outputs.embedding) &&
    outputs.embedding.length > 0 &&
    outputs.embedding.every((value) => Number.isFinite(value))
  );
}

function readPersistedCompletedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readPersistedCompletedStringArray(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }

  return [...value];
}

function readPersistedCompletedEmbedding(
  value: unknown,
): number[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return undefined;
  }

  return [...value];
}

function resolvePersistedCompletedOutputs(
  inspiration: InspirationEnrichmentExecutionRecord,
): InspirationEnrichmentCompletedOutputs {
  const actionability = readPersistedCompletedString(inspiration.actionability);
  const domain = readPersistedCompletedString(inspiration.domain);
  const embedding = readPersistedCompletedEmbedding(inspiration.embedding);
  const mood = readPersistedCompletedString(inspiration.mood);
  const summary = readPersistedCompletedString(inspiration.summary);
  const tags = readPersistedCompletedStringArray(inspiration.tags);
  const title = readPersistedCompletedString(inspiration.title);

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

function resolveAvailableCompletedFieldNames(
  outputs: InspirationEnrichmentCompletedOutputs,
): Set<InspirationEnrichmentFieldName> {
  const availableCompletedFieldNames = new Set<InspirationEnrichmentFieldName>();

  if (outputs.title !== undefined) {
    availableCompletedFieldNames.add("title");
  }

  if (typeof outputs.summary === "string") {
    availableCompletedFieldNames.add("summary");
  }

  if (Array.isArray(outputs.tags)) {
    availableCompletedFieldNames.add("tags");
  }

  if (typeof outputs.domain === "string") {
    availableCompletedFieldNames.add("domain");
  }

  if (typeof outputs.mood === "string") {
    availableCompletedFieldNames.add("mood");
  }

  if (typeof outputs.actionability === "string") {
    availableCompletedFieldNames.add("actionability");
  }

  if (hasCompletedEmbeddingOutput(outputs)) {
    availableCompletedFieldNames.add("embedding");
  }

  return availableCompletedFieldNames;
}

function resolveSelectedFieldNames(
  remainingFieldNames: readonly InspirationEnrichmentFieldName[],
  requestedFieldNames?: readonly InspirationEnrichmentFieldName[],
): InspirationEnrichmentFieldName[] {
  if (requestedFieldNames === undefined) {
    return [...remainingFieldNames];
  }

  const remainingFieldNameSet = new Set(remainingFieldNames);

  return resolveOrderedFieldNames(
    requestedFieldNames.filter((fieldName) => remainingFieldNameSet.has(fieldName)),
  );
}

export function resolveInspirationEnrichmentExecutionPlan(
  inspiration: InspirationEnrichmentExecutionRecord,
  options: ResolveInspirationEnrichmentExecutionPlanOptions = {},
): InspirationEnrichmentExecutionPlan {
  const capture = createInspirationEnrichmentResumeCapture(inspiration);
  const existingTitle =
    typeof inspiration.title === "string" && inspiration.title.trim().length > 0
      ? inspiration.title
      : undefined;
  const persistedCompletedOutputs = resolvePersistedCompletedOutputs(inspiration);
  const storedResumeState = options.forceFullReprocessing
    ? null
    : normalizeInspirationEnrichmentResumeState(
        inspiration.enrichmentResumeState,
        `Inspiration ${inspiration.id} enrichmentResumeState`,
      );
  const existingFields = normalizeInspirationEnrichmentFields(
    inspiration.enrichmentFields,
    `Inspiration ${inspiration.id} enrichmentFields`,
  );

  if (!storedResumeState) {
    const completedOutputs: InspirationEnrichmentCompletedOutputs = {
      ...(options.forceFullReprocessing
        ? existingTitle === undefined
          ? {}
          : {
              title: existingTitle,
            }
        : persistedCompletedOutputs),
    };
    const completedFieldNames = resolveOrderedFieldNames(
      resolveAvailableCompletedFieldNames(completedOutputs),
    );
    const remainingFieldNames = resolveOrderedFieldNames(
      INSPIRATION_ENRICHMENT_FIELD_NAMES.filter(
        (fieldName) => !completedFieldNames.includes(fieldName),
      ),
    );

    return {
      capture,
      completedFieldNames,
      completedOutputs,
      existingFields,
      fieldNamesToProcess: resolveSelectedFieldNames(
        remainingFieldNames,
        options.requestedFieldNames,
      ),
      remainingFieldNames,
    };
  }

  const completedOutputs: InspirationEnrichmentCompletedOutputs = {
    ...storedResumeState.completedOutputs,
    ...persistedCompletedOutputs,
  };
  const availableCompletedFieldNames =
    resolveAvailableCompletedFieldNames(completedOutputs);
  const storedCompletedFieldNames = new Set(
    storedResumeState.completedFieldNames,
  );
  const completedFieldNames = resolveOrderedFieldNames(
    availableCompletedFieldNames,
  );
  const remainingFieldNameSet = new Set(storedResumeState.remainingFieldNames);

  for (const fieldName of availableCompletedFieldNames) {
    remainingFieldNameSet.delete(fieldName);
  }

  for (const fieldName of storedCompletedFieldNames) {
    if (!availableCompletedFieldNames.has(fieldName)) {
      remainingFieldNameSet.add(fieldName);
    }
  }

  const remainingFieldNames = resolveOrderedFieldNames(remainingFieldNameSet);
  const resumeState = buildInspirationEnrichmentResumeState({
    capture: storedResumeState.capture,
    completedFieldNames,
    completedOutputs,
    remainingFieldNames,
    updatedAt: new Date(storedResumeState.updatedAt),
  });

  return {
    capture: storedResumeState.capture,
    completedFieldNames,
    completedOutputs,
    existingFields,
    fieldNamesToProcess: resolveSelectedFieldNames(
      remainingFieldNames,
      options.requestedFieldNames,
    ),
    remainingFieldNames,
    resumeState,
  };
}
