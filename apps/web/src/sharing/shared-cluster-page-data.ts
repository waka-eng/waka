import type { InspirationSourceType } from "../inspirations/create-route.ts";
import { SUPPORTED_INSPIRATION_SOURCE_TYPES } from "../inspirations/create-route.ts";
import { getSharedInspirationSourcePresentation } from "./shared-inspiration-page-data.ts";

export const SHARED_CLUSTER_PAGE_DEPENDENCIES_MISSING_ERROR =
  "Shared cluster page dependencies have not been configured.";
export const SHARED_CLUSTER_NOT_FOUND_ERROR = "Shared cluster not found.";
export const SHARED_CLUSTER_FALLBACK_DESCRIPTION =
  "A shared collection from Waka.";
export const SHARED_CLUSTER_ITEM_TITLE_MAX_LENGTH = 80;
export const SHARED_CLUSTER_ITEM_SUMMARY_MAX_LENGTH = 220;
export const SHARED_CLUSTER_ITEM_EXCERPT_MAX_LENGTH = 240;

export interface SharedClusterInspirationRecord {
  createdAt: unknown;
  domain?: unknown;
  id: unknown;
  rawContent: unknown;
  shareSlug?: unknown;
  sourceType: unknown;
  sourceUrl?: unknown;
  summary?: unknown;
  tags?: unknown;
  title?: unknown;
}

export interface SharedClusterRecord {
  createdAt: unknown;
  description?: unknown;
  id: unknown;
  inspirations: readonly SharedClusterInspirationRecord[];
  label: unknown;
  shareSlug: unknown;
}

export interface SharedClusterPersistenceArgs {
  select: {
    createdAt: true;
    description: true;
    id: true;
    inspirations: {
      orderBy: {
        createdAt: "desc";
      };
      select: {
        createdAt: true;
        domain: true;
        id: true;
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
      };
    };
    label: true;
    shareSlug: true;
  };
  where: {
    isPublic: true;
    shareSlug: string;
  };
}

export interface SharedClusterPersistenceClient<
  TRecord extends SharedClusterRecord = SharedClusterRecord,
> {
  cluster: {
    findFirst(args: SharedClusterPersistenceArgs): Promise<TRecord | null>;
  };
}

export interface SharedClusterPageDependencies<
  TRecord extends SharedClusterRecord = SharedClusterRecord,
> {
  persistence: SharedClusterPersistenceClient<TRecord>;
}

export interface SharedClusterItemCardData {
  createdAt: string;
  createdLabel: string;
  domain?: string;
  excerpt: string;
  id: string;
  shareSlug?: string;
  sourceLabel: string;
  sourceLabelShort: string;
  sourceType: InspirationSourceType;
  sourceUrl?: string;
  summary: string;
  tags: string[];
  title: string;
}

export interface SharedClusterCardData {
  createdAt: string;
  createdLabel: string;
  description: string;
  id: string;
  inspirations: SharedClusterItemCardData[];
  itemCount: number;
  label: string;
  shareSlug: string;
}

export type LoadSharedClusterPageData = (
  shareSlug: string,
) => Promise<SharedClusterCardData>;

let defaultSharedClusterPageDependencies: SharedClusterPageDependencies | null =
  null;

export class SharedClusterNotFoundError extends Error {
  constructor() {
    super(SHARED_CLUSTER_NOT_FOUND_ERROR);
    this.name = "SharedClusterNotFoundError";
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
  identifier: string,
): InspirationSourceType {
  if (
    typeof value === "string" &&
    SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(value as InspirationSourceType)
  ) {
    return value as InspirationSourceType;
  }

  throw new TypeError(
    `Shared cluster record ${identifier} returned an invalid sourceType value.`,
  );
}

function normalizeTimestamp(value: unknown, label: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} returned an invalid timestamp value.`);
  }

  return date.toISOString();
}

function formatSharedCreatedLabel(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(createdAt));
}

function deriveSharedDomain(
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

function trimSharedTags(tags: string[] | undefined): string[] {
  if (tags === undefined) {
    return [];
  }

  return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function buildSharedTitle(
  title: string | undefined,
  summary: string | undefined,
  rawContent: string,
): string {
  const normalizedTitle = collapseWhitespace(title ?? "");

  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }

  const fallbackSource = summary ?? rawContent;
  const excerpt = toExcerpt(fallbackSource, SHARED_CLUSTER_ITEM_TITLE_MAX_LENGTH);

  return excerpt.length > 0 ? excerpt : "Untitled inspiration";
}

function buildSharedSummary(
  summary: string | undefined,
  rawContent: string,
): string {
  const normalizedSummary = collapseWhitespace(summary ?? "");

  if (normalizedSummary.length > 0) {
    return normalizedSummary;
  }

  const excerpt = toExcerpt(rawContent, SHARED_CLUSTER_ITEM_SUMMARY_MAX_LENGTH);

  return excerpt.length > 0 ? excerpt : SHARED_CLUSTER_FALLBACK_DESCRIPTION;
}

function buildSharedDescription(
  description: string | undefined,
  itemCount: number,
): string {
  const normalizedDescription = collapseWhitespace(description ?? "");

  if (normalizedDescription.length > 0) {
    return normalizedDescription;
  }

  if (itemCount === 1) {
    return "1 shared note from this Waka collection.";
  }

  if (itemCount > 1) {
    return `${itemCount} shared notes from this Waka collection.`;
  }

  return SHARED_CLUSTER_FALLBACK_DESCRIPTION;
}

function normalizeSharedClusterItem(
  item: SharedClusterInspirationRecord,
  clusterShareSlug: string,
  itemIndex: number,
): SharedClusterItemCardData {
  const id = readRequiredTrimmedString(
    item.id,
    `Shared cluster ${clusterShareSlug} inspiration ${itemIndex + 1} id`,
  );
  const rawContent = readRequiredRawContent(
    item.rawContent,
    `Shared cluster ${clusterShareSlug} inspiration ${id} rawContent`,
  );
  const sourceType = normalizeSharedInspirationSourceType(
    item.sourceType,
    `${clusterShareSlug}:${id}`,
  );
  const createdAt = normalizeTimestamp(
    item.createdAt,
    `Shared cluster ${clusterShareSlug} inspiration ${id} createdAt`,
  );
  const sourceUrl = normalizeOptionalAbsoluteUrl(item.sourceUrl);
  const title = normalizeOptionalString(item.title);
  const summary = normalizeOptionalString(item.summary);
  const domain = normalizeOptionalString(item.domain);
  const tags = normalizeOptionalStringArray(item.tags);
  const shareSlug = normalizeOptionalString(item.shareSlug);
  const sourcePresentation = getSharedInspirationSourcePresentation(sourceType);

  return {
    createdAt,
    createdLabel: formatSharedCreatedLabel(createdAt),
    ...(deriveSharedDomain(domain, sourceUrl) === undefined
      ? {}
      : {
          domain: deriveSharedDomain(domain, sourceUrl),
        }),
    excerpt: toExcerpt(rawContent, SHARED_CLUSTER_ITEM_EXCERPT_MAX_LENGTH),
    id,
    ...(shareSlug === undefined ? {} : { shareSlug: shareSlug.trim() }),
    sourceLabel: sourcePresentation.label,
    sourceLabelShort: sourcePresentation.shortLabel,
    sourceType,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    summary: buildSharedSummary(summary, rawContent),
    tags: trimSharedTags(tags),
    title: buildSharedTitle(title, summary, rawContent),
  };
}

function resolveSharedClusterPageDependencies<
  TRecord extends SharedClusterRecord = SharedClusterRecord,
>(
  override?: SharedClusterPageDependencies<TRecord>,
): SharedClusterPageDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultSharedClusterPageDependencies) {
    return defaultSharedClusterPageDependencies as SharedClusterPageDependencies<TRecord>;
  }

  throw new Error(SHARED_CLUSTER_PAGE_DEPENDENCIES_MISSING_ERROR);
}

export function configureSharedClusterPageDependencies(
  dependencies: SharedClusterPageDependencies | null,
): void {
  defaultSharedClusterPageDependencies = dependencies;
}

export function buildSharedClusterPersistenceArgs(
  shareSlug: string,
): SharedClusterPersistenceArgs {
  return {
    where: {
      isPublic: true,
      shareSlug: readRequiredTrimmedString(shareSlug, "shareSlug"),
    },
    select: {
      createdAt: true,
      description: true,
      id: true,
      inspirations: {
        where: {
          deletedAt: null,
          isPublic: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          createdAt: true,
          domain: true,
          id: true,
          rawContent: true,
          shareSlug: true,
          sourceType: true,
          sourceUrl: true,
          summary: true,
          tags: true,
          title: true,
        },
      },
      label: true,
      shareSlug: true,
    },
  };
}

export async function loadSharedClusterPageData<
  TRecord extends SharedClusterRecord = SharedClusterRecord,
>(
  shareSlug: string,
  override?: SharedClusterPageDependencies<TRecord>,
): Promise<SharedClusterCardData> {
  const dependencies = resolveSharedClusterPageDependencies(override);
  const record = await dependencies.persistence.cluster.findFirst(
    buildSharedClusterPersistenceArgs(shareSlug),
  );

  if (record === null) {
    throw new SharedClusterNotFoundError();
  }

  const normalizedShareSlug = readRequiredTrimmedString(
    record.shareSlug,
    "Cluster shareSlug",
  );
  const inspirations = record.inspirations.map((item, itemIndex) =>
    normalizeSharedClusterItem(item, normalizedShareSlug, itemIndex),
  );
  const createdAt = normalizeTimestamp(
    record.createdAt,
    `Shared cluster ${normalizedShareSlug} createdAt`,
  );

  return {
    createdAt,
    createdLabel: formatSharedCreatedLabel(createdAt),
    description: buildSharedDescription(
      normalizeOptionalString(record.description),
      inspirations.length,
    ),
    id: readRequiredTrimmedString(record.id, "Shared cluster id"),
    inspirations,
    itemCount: inspirations.length,
    label: readRequiredTrimmedString(record.label, "Shared cluster label"),
    shareSlug: normalizedShareSlug,
  };
}
