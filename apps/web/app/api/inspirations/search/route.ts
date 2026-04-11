import type { NextRequest } from "next/server";

import { handleSearchInspirationsRouteRequest } from "../../../../src/inspirations/search-route.ts";

export async function GET(request: NextRequest) {
  return handleSearchInspirationsRouteRequest(request);
}
