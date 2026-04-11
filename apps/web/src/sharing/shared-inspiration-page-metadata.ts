import type { Metadata } from "next";

import {
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
} from "./shared-inspiration-open-graph-image.ts";
import {
  loadSharedInspirationPageData,
  type LoadSharedInspirationPageData,
} from "./shared-inspiration-page-data.ts";

export const SHARED_INSPIRATION_METADATA_APP_URL_ENVIRONMENT_KEY = "APP_URL";
export const SHARED_INSPIRATION_METADATA_DEFAULT_APP_URL =
  "http://localhost:3000";
export const SHARED_INSPIRATION_METADATA_TWITTER_CARD = "summary_large_image";

function readConfiguredAppUrl(env: NodeJS.ProcessEnv): string {
  const value = env[SHARED_INSPIRATION_METADATA_APP_URL_ENVIRONMENT_KEY];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : SHARED_INSPIRATION_METADATA_DEFAULT_APP_URL;
}

export function resolveSharedInspirationMetadataBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): URL {
  const configuredAppUrl = readConfiguredAppUrl(env);

  try {
    return new URL(configuredAppUrl);
  } catch {
    throw new Error(
      `${SHARED_INSPIRATION_METADATA_APP_URL_ENVIRONMENT_KEY} "${configuredAppUrl}" must be a valid absolute URL.`,
    );
  }
}

export function buildSharedInspirationCanonicalUrl(
  shareSlug: string,
  metadataBase: URL,
): string {
  return new URL(`/s/${encodeURIComponent(shareSlug)}`, metadataBase).toString();
}

export function buildSharedInspirationOpenGraphImageUrl(
  shareSlug: string,
  metadataBase: URL,
): string {
  return new URL(
    `/s/${encodeURIComponent(shareSlug)}/opengraph-image`,
    metadataBase,
  ).toString();
}

export async function loadSharedInspirationPageMetadata(
  shareSlug: string,
  loadInspiration: LoadSharedInspirationPageData = loadSharedInspirationPageData,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Metadata> {
  const inspiration = await loadInspiration(shareSlug);
  const metadataBase = resolveSharedInspirationMetadataBaseUrl(env);
  const canonicalUrl = buildSharedInspirationCanonicalUrl(
    inspiration.shareSlug,
    metadataBase,
  );
  const imageUrl = buildSharedInspirationOpenGraphImageUrl(
    inspiration.shareSlug,
    metadataBase,
  );
  const title = `${inspiration.title} | ${SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL}`;

  return {
    metadataBase,
    title,
    description: inspiration.summary,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: "article",
      url: canonicalUrl,
      title,
      description: inspiration.summary,
      siteName: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
      images: [
        {
          url: imageUrl,
          width: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
          height: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
          alt: title,
        },
      ],
    },
    twitter: {
      card: SHARED_INSPIRATION_METADATA_TWITTER_CARD,
      title,
      description: inspiration.summary,
      images: [imageUrl],
    },
  };
}
