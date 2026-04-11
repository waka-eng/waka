import type {
  LoadSharedClusterPageData,
  SharedClusterCardData,
} from "./shared-cluster-page-data.ts";
import {
  loadSharedClusterPageData,
  SharedClusterNotFoundError,
} from "./shared-cluster-page-data.ts";
import type {
  LoadSharedInspirationPageData,
  SharedInspirationCardData,
} from "./shared-inspiration-page-data.ts";
import {
  loadSharedInspirationPageData,
  SharedInspirationNotFoundError,
} from "./shared-inspiration-page-data.ts";

export interface SharedInspirationPublicPageData extends SharedInspirationCardData {
  kind: "inspiration";
}

export interface SharedClusterPublicPageData extends SharedClusterCardData {
  kind: "cluster";
}

export type SharedPublicPageData =
  | SharedInspirationPublicPageData
  | SharedClusterPublicPageData;

export type LoadSharedPublicPageData = (
  shareSlug: string,
) => Promise<SharedPublicPageData>;

export class SharedPublicPageNotFoundError extends Error {
  constructor() {
    super("Shared public page not found.");
    this.name = "SharedPublicPageNotFoundError";
  }
}

export async function loadSharedPublicPageData(
  shareSlug: string,
  options?: {
    loadCluster?: LoadSharedClusterPageData;
    loadInspiration?: LoadSharedInspirationPageData;
  },
): Promise<SharedPublicPageData> {
  const loadInspiration =
    options?.loadInspiration ?? loadSharedInspirationPageData;
  const loadCluster = options?.loadCluster ?? loadSharedClusterPageData;

  try {
    return {
      kind: "inspiration",
      ...(await loadInspiration(shareSlug)),
    };
  } catch (error) {
    if (!(error instanceof SharedInspirationNotFoundError)) {
      throw error;
    }
  }

  try {
    return {
      kind: "cluster",
      ...(await loadCluster(shareSlug)),
    };
  } catch (error) {
    if (error instanceof SharedClusterNotFoundError) {
      throw new SharedPublicPageNotFoundError();
    }

    throw error;
  }
}
