import type { NextRequest } from "next/server";

import { handleUpdateClusterRouteRequest } from "../../../../src/clusters/update-route.ts";

interface ClusterRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PUT(request: NextRequest, context: ClusterRouteContext) {
  const params = await context.params;

  return handleUpdateClusterRouteRequest(request, {
    params: {
      clusterId: params.id,
    },
  });
}
