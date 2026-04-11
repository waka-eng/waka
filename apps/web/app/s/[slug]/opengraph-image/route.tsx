import { ImageResponse } from "next/og";

import {
  buildSharedInspirationOpenGraphImageLookupFallbackModel,
  buildSharedInspirationOpenGraphImageLookupFallbackResponseHeaders,
  buildSharedInspirationOpenGraphImageResponseHeaders,
  loadSharedInspirationOpenGraphImageModel,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
} from "../../../../src/sharing/shared-inspiration-open-graph-image.ts";
import { SharedInspirationOpenGraphImageTemplate } from "../../../../src/sharing/shared-inspiration-open-graph-image-template.ts";

export const dynamic = "force-dynamic";

interface SharedInspirationOpenGraphImageRouteParams {
  slug: string;
}

interface SharedInspirationOpenGraphImageRouteContext {
  params: Promise<SharedInspirationOpenGraphImageRouteParams>;
}

export async function GET(
  _request: Request,
  context: SharedInspirationOpenGraphImageRouteContext,
): Promise<Response> {
  const { slug } = await context.params;
  const image = await loadSharedInspirationOpenGraphImageModel(slug);
  const responseImage =
    image ?? buildSharedInspirationOpenGraphImageLookupFallbackModel(slug);
  const responseHeaders =
    image === null
      ? buildSharedInspirationOpenGraphImageLookupFallbackResponseHeaders()
      : buildSharedInspirationOpenGraphImageResponseHeaders();

  return new ImageResponse(
    <SharedInspirationOpenGraphImageTemplate image={responseImage} />,
    {
      width: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
      height: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
      headers: responseHeaders,
    },
  );
}
