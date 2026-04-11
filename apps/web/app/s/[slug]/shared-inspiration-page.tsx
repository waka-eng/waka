import { notFound } from "next/navigation";

import {
  loadSharedPublicPageData,
  type LoadSharedPublicPageData,
  SharedPublicPageNotFoundError,
} from "../../../src/sharing/shared-public-page-data.ts";
import { SharedClusterCardView } from "./shared-cluster-card.tsx";
import { SharedInspirationCardView } from "./shared-inspiration-card.tsx";

export interface SharedInspirationRouteParams {
  slug: string;
}

export interface SharedInspirationPublicPageProps {
  loadShare?: LoadSharedPublicPageData;
  params: Promise<SharedInspirationRouteParams> | SharedInspirationRouteParams;
}

export async function SharedInspirationPublicPage({
  loadShare = loadSharedPublicPageData,
  params,
}: SharedInspirationPublicPageProps) {
  const { slug } = await params;

  try {
    const share = await loadShare(slug);

    if (share.kind === "cluster") {
      return <SharedClusterCardView cluster={share} />;
    }

    return <SharedInspirationCardView inspiration={share} />;
  } catch (error) {
    if (error instanceof SharedPublicPageNotFoundError) {
      notFound();
    }

    throw error;
  }
}
