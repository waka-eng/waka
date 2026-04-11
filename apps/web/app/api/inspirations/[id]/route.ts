import type { NextRequest } from "next/server";

import { handleDeleteInspirationRouteRequest } from "../../../../src/inspirations/delete-route.ts";
import { handleReadInspirationRouteRequest } from "../../../../src/inspirations/read-route.ts";
import { handleUpdateInspirationRouteRequest } from "../../../../src/inspirations/update-route.ts";
import {
  createDeleteInspirationRouteDependenciesForRequest,
  createReadInspirationRouteDependenciesForRequest,
  createUpdateInspirationRouteDependenciesForRequest,
} from "../../../../src/auth/runtime.ts";

interface InspirationRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PUT(
  request: NextRequest,
  context: InspirationRouteContext,
) {
  const params = await context.params;

  return handleUpdateInspirationRouteRequest(request, {
    dependencies: await createUpdateInspirationRouteDependenciesForRequest(request),
    params: {
      inspirationId: params.id,
    },
  });
}

export async function GET(
  request: NextRequest,
  context: InspirationRouteContext,
) {
  const params = await context.params;

  return handleReadInspirationRouteRequest(request, {
    dependencies: await createReadInspirationRouteDependenciesForRequest(request),
    params: {
      inspirationId: params.id,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: InspirationRouteContext,
) {
  const params = await context.params;

  return handleDeleteInspirationRouteRequest(request, {
    dependencies: await createDeleteInspirationRouteDependenciesForRequest(request),
    params: {
      inspirationId: params.id,
    },
  });
}
