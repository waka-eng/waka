import type { NextRequest } from "next/server";

import { handleCompleteAudioIngestionRouteRequest } from "../../../../src/media/audio-ingestion-complete-route.ts";

export async function POST(request: NextRequest) {
  return handleCompleteAudioIngestionRouteRequest(request);
}
