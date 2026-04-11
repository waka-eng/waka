import type { InspirationSourceType } from "../inspirations/create-route.ts";
import { SUPPORTED_INSPIRATION_SOURCE_TYPES } from "../inspirations/create-route.ts";

export const SHARED_INSPIRATION_PAGE_DEPENDENCIES_MISSING_ERROR =
  "Shared inspiration page dependencies have not been configured.";
export const SHARED_INSPIRATION_NOT_FOUND_ERROR =
  "Shared inspiration not found.";
export const SHARED_INSPIRATION_FALLBACK_TITLE = "Untitled note";
export const SHARED_INSPIRATION_FALLBACK_SUMMARY =
  "A shared note from Waka.";

const SHARED_INSPIRATION_TITLE_MAX_LENGTH = 80;
const SHARED_INSPIRATION_SUMMARY_MAX_LENGTH = 220;

export interface SharedInspirationRecord {
  createdAt: unknown;
  domain?: unknown;
  rawContent: unknown;
  shareSlug: unknown;
  sourceType: unknown;
  sourceUrl?: unknown;
  summary?: unknown;
  tags?: unknown;
  title?: unknown;
}

export interface SharedInspirationPersistenceArgs {
  select: {
    createdAt: true;
    domain: true;
    rawContent: true;
    shareSlug: true;
    sourceType: true;
    sourceUrl: true;
    summary: true;
    tags: true;
    title: true;
  };
  where: {
    deletedAt: null;
    isPublic: true;
    shareSlug: string;
  };
}

export interface SharedInspirationPersistenceClient<
  TRecord extends SharedInspirationRecord = SharedInspirationRecord,
> {
  inspiration: {
    findFirst(args: SharedInspirationPersistenceArgs): Promise<TRecord | null>;
  };
}

export interface SharedInspirationPageDependencies<
  TRecord extends SharedInspirationRecord = SharedInspirationRecord,
> {
  persistence: SharedInspirationPersistenceClient<TRecord>;
}

export interface SharedInspirationSourcePresentation {
  label: string;
  shortLabel: string;
}

export interface SharedInspirationCardData {
  createdAt: string;
  createdLabel: string;
  domain?: string;
  rawContent: string;
  shareSlug: string;
  sourceType: InspirationSourceType;
  sourceLabel: string;
  sourceLabelShort: string;
  sourceUrl?: string;
  summary: string;
  tags: string[];
  title: string;
}

export type LoadSharedInspirationPageData = (
  shareSlug: string,
) => Promise<SharedInspirationCardData>;

let defaultSharedInspirationPageDependencies:
  | SharedInspirationPageDependencies
  | null = null;

export class SharedInspirationNotFoundError extends Error {
  constructor() {
    super(SHARED_INSPIRATION_NOT_FOUND_ERROR);
    this.name = "SharedInspirationNotFoundError";
  }
}

function readRequiredTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readRequiredRawContent(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be at least 1 character.`);
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected an optional string field.");
  }

  return value;
}

function normalizeOptionalAbsoluteUrl(value: unknown): string | undefined {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === undefined) {
    return undefined;
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError("sourceUrl must be a valid absolute URL.");
  }
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError("tags must be an array of strings.");
  }

  return value;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toExcerpt(value: string, maxLength: number): string {
  const normalizedValue = collapseWhitespace(value);

  if (normalizedValue.length === 0) {
    return "";
  }

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeSharedInspirationSourceType(
  value: unknown,
  shareSlug: string,
): InspirationSourceType {
  if (
    typeof value === "string" &&
    SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(value as InspirationSourceType)
  ) {
    return value as InspirationSourceType;
  }

  throw new TypeError(
    `Shared inspiration ${shareSlug} returned an invalid sourceType value.`,
  );
}

function normalizeTimestamp(value: unknown, shareSlug: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Shared inspiration ${shareSlug} returned an invalid createdAt value.`,
    );
  }

  return date.toISOString();
}

function formatSharedInspirationCreatedLabel(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(createdAt));
}

function deriveSharedInspirationDomain(
  domain: string | undefined,
  sourceUrl: string | undefined,
): string | undefined {
  const normalizedDomain = domain?.trim();

  if (normalizedDomain) {
    return normalizedDomain;
  }

  if (sourceUrl === undefined) {
    return undefined;
  }

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./u, "");
  } catch {
    return undefined;
  }
}

function trimSharedInspirationTags(tags: string[] | undefined): string[] {
  if (tags === undefined) {
    return [];
  }

  const normalizedTags = tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  return normalizedTags;
}

export function getSharedInspirationSourcePresentation(
  sourceType: InspirationSourceType,
): SharedInspirationSourcePresentation {
  switch (sourceType) {
    case "TEXT_NOTE":
      return {
        label: "Text note",
        shortLabel: "TXT",
      };
    case "URL_IMPORT":
      return {
        label: "URL import",
        shortLabel: "URL",
      };
    case "VOICE_NOTE":
      return {
        label: "Voice note",
        shortLabel: "MIC",
      };
    case "PHOTO":
      return {
        label: "Photo capture",
        shortLabel: "IMG",
      };
    case "CLI_CONVERSATION":
      return {
        label: "CLI capture",
        shortLabel: "CLI",
      };
    case "AI_CONVERSATION":
      return {
        label: "AI conversation",
        shortLabel: "AI",
      };
  }
}

function buildSharedInspirationTitle(
  title: string | undefined,
  summary: string | undefined,
  rawContent: string,
): string {
  const normalizedTitle = collapseWhitespace(title ?? "");

  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }

  const fallbackSource = summary ?? rawContent;
  const excerpt = toExcerpt(fallbackSource, SHARED_INSPIRATION_TITLE_MAX_LENGTH);

  return excerpt.length > 0 ? excerpt : SHARED_INSPIRATION_FALLBACK_TITLE;
}

function buildSharedInspirationSummary(
  summary: string | undefined,
  rawContent: string,
): string {
  const normalizedSummary = collapseWhitespace(summary ?? "");

  if (normalizedSummary.length > 0) {
    return normalizedSummary;
  }

  const excerpt = toExcerpt(rawContent, SHARED_INSPIRATION_SUMMARY_MAX_LENGTH);

  return excerpt.length > 0 ? excerpt : SHARED_INSPIRATION_FALLBACK_SUMMARY;
}

function resolveSharedInspirationPageDependencies<
  TRecord extends SharedInspirationRecord = SharedInspirationRecord,
>(
  override?: SharedInspirationPageDependencies<TRecord>,
): SharedInspirationPageDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultSharedInspirationPageDependencies) {
    return defaultSharedInspirationPageDependencies as SharedInspirationPageDependencies<TRecord>;
  }

  throw new Error(SHARED_INSPIRATION_PAGE_DEPENDENCIES_MISSING_ERROR);
}

export function configureSharedInspirationPageDependencies(
  dependencies: SharedInspirationPageDependencies | null,
): void {
  defaultSharedInspirationPageDependencies = dependencies;
}

export function buildSharedInspirationPersistenceArgs(
  shareSlug: string,
): SharedInspirationPersistenceArgs {
  return {
    where: {
      deletedAt: null,
      isPublic: true,
      shareSlug: readRequiredTrimmedString(shareSlug, "shareSlug"),
    },
    select: {
      createdAt: true,
      domain: true,
      rawContent: true,
      shareSlug: true,
      sourceType: true,
      sourceUrl: true,
      summary: true,
      tags: true,
      title: true,
    },
  };
}

export async function loadSharedInspirationPageData<
  TRecord extends SharedInspirationRecord = SharedInspirationRecord,
>(
  shareSlug: string,
  override?: SharedInspirationPageDependencies<TRecord>,
): Promise<SharedInspirationCardData> {
  const dependencies = resolveSharedInspirationPageDependencies(override);
  const record = await dependencies.persistence.inspiration.findFirst(
    buildSharedInspirationPersistenceArgs(shareSlug),
  );

  if (record === null) {
    throw new SharedInspirationNotFoundError();
  }

  const normalizedShareSlug = readRequiredTrimmedString(
    record.shareSlug,
    "shareSlug",
  );
  const rawContent = readRequiredRawContent(
    record.rawContent,
    `Shared inspiration ${normalizedShareSlug} rawContent`,
  );
  const sourceType = normalizeSharedInspirationSourceType(
    record.sourceType,
    normalizedShareSlug,
  );
  const createdAt = normalizeTimestamp(record.createdAt, normalizedShareSlug);
  const sourceUrl = normalizeOptionalAbsoluteUrl(record.sourceUrl);
  const title = normalizeOptionalString(record.title);
  const summary = normalizeOptionalString(record.summary);
  const domain = normalizeOptionalString(record.domain);
  const tags = normalizeOptionalStringArray(record.tags);
  const sourcePresentation = getSharedInspirationSourcePresentation(sourceType);

  return {
    createdAt,
    createdLabel: formatSharedInspirationCreatedLabel(createdAt),
    ...(deriveSharedInspirationDomain(domain, sourceUrl) === undefined
      ? {}
      : {
          domain: deriveSharedInspirationDomain(domain, sourceUrl),
        }),
    rawContent,
    shareSlug: normalizedShareSlug,
    sourceType,
    sourceLabel: sourcePresentation.label,
    sourceLabelShort: sourcePresentation.shortLabel,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    summary: buildSharedInspirationSummary(summary, rawContent),
    tags: trimSharedInspirationTags(tags),
    title: buildSharedInspirationTitle(title, summary, rawContent),
  };
}
