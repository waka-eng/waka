import type { NextRequest } from "next/server";

import { handleCreateInspirationRouteRequest } from "../../../src/inspirations/create-route.ts";
import { handleListInspirationsRouteRequest } from "../../../src/inspirations/list-route.ts";
import {
  createCreateInspirationRouteDependenciesForRequest,
  createListInspirationsRouteDependenciesForRequest,
} from "../../../src/auth/runtime.ts";

export async function GET(request: NextRequest) {
  return handleListInspirationsRouteRequest(request, {
    dependencies: await createListInspirationsRouteDependenciesForRequest(request),
  });
}

export async function POST(request: NextRequest) {
  return handleCreateInspirationRouteRequest(request, {
    dependencies: await createCreateInspirationRouteDependenciesForRequest(request),
  });
}
