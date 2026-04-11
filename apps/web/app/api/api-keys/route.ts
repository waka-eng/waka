import type { NextRequest } from "next/server";

import { handleCreateApiKeyRouteRequest } from "../../../src/auth/api-key-create-route.ts";
import { handleRevokeApiKeyRouteRequest } from "../../../src/auth/api-key-revoke-route.ts";
import {
  createCreateApiKeyRouteDependenciesForRequest,
  createRevokeApiKeyRouteDependenciesForRequest,
} from "../../../src/auth/runtime.ts";

function requestHasRuntimeAuthContext(request: Request): boolean {
  return (
    (request.headers.get("cookie")?.trim().length ?? 0) > 0 ||
    (request.headers.get("authorization")?.trim().length ?? 0) > 0
  );
}

export async function POST(request: NextRequest) {
  if (!requestHasRuntimeAuthContext(request)) {
    return handleCreateApiKeyRouteRequest(request);
  }

  return handleCreateApiKeyRouteRequest(request, {
    dependencies: await createCreateApiKeyRouteDependenciesForRequest(request),
  });
}

export async function DELETE(request: NextRequest) {
  if (!requestHasRuntimeAuthContext(request)) {
    return handleRevokeApiKeyRouteRequest(request);
  }

  return handleRevokeApiKeyRouteRequest(request, {
    dependencies: await createRevokeApiKeyRouteDependenciesForRequest(request),
  });
}
