import {
  loadSharedInspirationPageData,
  type LoadSharedInspirationPageData,
  SHARED_INSPIRATION_FALLBACK_SUMMARY,
  SHARED_INSPIRATION_FALLBACK_TITLE,
  SharedInspirationNotFoundError,
} from "./shared-inspiration-page-data.ts";

export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH = 1200;
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT = 630;
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CONTENT_TYPE = "image/png";
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_LOOKUP_FALLBACK_CACHE_CONTROL =
  "no-store";
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL = "Waka share";
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL =
  "Recently shared";
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL =
  "Waka capture";
export const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT =
  "WAKA";

const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_SUMMARY_MAX_LENGTH = 180;

export interface SharedInspirationOpenGraphImageModel {
  createdLabel: string;
  domain?: string;
  shareSlug: string;
  sourceLabel: string;
  sourceLabelShort: string;
  summarySnippet: string;
  title: string;
}

export type SharedInspirationOpenGraphImageModelInput = Partial<
  Record<keyof SharedInspirationOpenGraphImageModel, unknown>
>;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = collapseWhitespace(value);

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function toExcerpt(value: string, maxLength: number): string {
  const normalizedValue = collapseWhitespace(value);

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeSharedInspirationOpenGraphImageTitle(value: unknown): string {
  return readOptionalTrimmedString(value) ?? SHARED_INSPIRATION_FALLBACK_TITLE;
}

function normalizeSharedInspirationOpenGraphImageSummarySnippet(
  value: unknown,
): string {
  const normalizedValue = readOptionalTrimmedString(value);

  if (normalizedValue === undefined) {
    return SHARED_INSPIRATION_FALLBACK_SUMMARY;
  }

  return toExcerpt(
    normalizedValue,
    SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_SUMMARY_MAX_LENGTH,
  );
}

export function normalizeSharedInspirationOpenGraphImageModel(
  image?: SharedInspirationOpenGraphImageModelInput | null,
  shareSlugFallback = "",
): SharedInspirationOpenGraphImageModel {
  const domain = readOptionalTrimmedString(image?.domain);

  return {
    createdLabel:
      readOptionalTrimmedString(image?.createdLabel) ??
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
    ...(domain === undefined ? {} : { domain }),
    shareSlug:
      readOptionalTrimmedString(image?.shareSlug) ??
      readOptionalTrimmedString(shareSlugFallback) ??
      "",
    sourceLabel:
      readOptionalTrimmedString(image?.sourceLabel) ??
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
    sourceLabelShort:
      readOptionalTrimmedString(image?.sourceLabelShort) ??
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
    summarySnippet: normalizeSharedInspirationOpenGraphImageSummarySnippet(
      image?.summarySnippet,
    ),
    title: normalizeSharedInspirationOpenGraphImageTitle(image?.title),
  };
}

export function buildSharedInspirationOpenGraphImageResponseHeaders(): Record<
  string,
  string
> {
  return {
    "cache-control": SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CACHE_CONTROL,
    "content-type": SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CONTENT_TYPE,
  };
}

export function buildSharedInspirationOpenGraphImageLookupFallbackModel(
  shareSlug: string,
): SharedInspirationOpenGraphImageModel {
  return normalizeSharedInspirationOpenGraphImageModel(
    { shareSlug },
    shareSlug,
  );
}

export function buildSharedInspirationOpenGraphImageLookupFallbackResponseHeaders(): Record<
  string,
  string
> {
  return {
    "cache-control":
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_LOOKUP_FALLBACK_CACHE_CONTROL,
    "content-type": SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CONTENT_TYPE,
  };
}

export async function loadSharedInspirationOpenGraphImageModel(
  shareSlug: string,
  loadInspiration: LoadSharedInspirationPageData = loadSharedInspirationPageData,
): Promise<SharedInspirationOpenGraphImageModel | null> {
  try {
    const inspiration = await loadInspiration(shareSlug);

    return normalizeSharedInspirationOpenGraphImageModel(
      {
        createdLabel: inspiration.createdLabel,
        domain: inspiration.domain,
        shareSlug: inspiration.shareSlug,
        sourceLabel: inspiration.sourceLabel,
        sourceLabelShort: inspiration.sourceLabelShort,
        summarySnippet: inspiration.summary,
        title: inspiration.title,
      },
      shareSlug,
    );
  } catch (error) {
    if (error instanceof SharedInspirationNotFoundError) {
      return null;
    }

    throw error;
  }
}
