import type { NextRequest } from "next/server";

import { handleListDiscoveriesRouteRequest } from "../../../src/discoveries/list-route.ts";

export async function GET(request: NextRequest) {
  return handleListDiscoveriesRouteRequest(request);
}
