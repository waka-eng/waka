import type { NextRequest } from "next/server";

import { handleDeepenInspirationRouteRequest } from "../../../../../src/inspirations/deepen-route.ts";

interface DeepenInspirationRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: DeepenInspirationRouteContext,
) {
  const params = await context.params;

  return handleDeepenInspirationRouteRequest(request, {
    params: {
      inspirationId: params.id,
    },
  });
}
