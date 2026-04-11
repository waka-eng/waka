import type { NextRequest } from "next/server";

import { handleInitiatePhotoIngestionRouteRequest } from "../../../../../src/media/photo-ingestion-init-route.ts";

export async function POST(request: NextRequest) {
  return handleInitiatePhotoIngestionRouteRequest(request);
}
