import type { NextRequest } from "next/server";

import { handleCreateApiKeyRouteRequest } from "../../../src/auth/api-key-create-route.ts";
import { handleRevokeApiKeyRouteRequest } from "../../../src/auth/api-key-revoke-route.ts";

export async function POST(request: NextRequest) {
  return handleCreateApiKeyRouteRequest(request);
}

export async function DELETE(request: NextRequest) {
  return handleRevokeApiKeyRouteRequest(request);
}
