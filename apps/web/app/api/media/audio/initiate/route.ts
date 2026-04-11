import type { NextRequest } from "next/server";

import { handleInitiateAudioIngestionRouteRequest } from "../../../../../src/media/audio-ingestion-init-route.ts";

export async function POST(request: NextRequest) {
  return handleInitiateAudioIngestionRouteRequest(request);
}
