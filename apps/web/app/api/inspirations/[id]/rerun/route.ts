import type { NextRequest } from "next/server";

import { handleRerunInspirationRouteRequest } from "../../../../../src/inspirations/rerun-route.ts";

interface RerunInspirationRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: RerunInspirationRouteContext,
) {
  const params = await context.params;

  return handleRerunInspirationRouteRequest(request, {
    params: {
      inspirationId: params.id,
    },
  });
}
