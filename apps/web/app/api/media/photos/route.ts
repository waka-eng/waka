import type { NextRequest } from "next/server";

import { handleCreatePhotoCaptureRouteRequest } from "../../../../src/media/create-photo-capture-route.ts";
import { handleCompletePhotoIngestionRouteRequest } from "../../../../src/media/photo-ingestion-complete-route.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isPhotoUploadCompletionRequest(
  request: Request,
): Promise<boolean> {
  try {
    const payload = await request.clone().json();

    return (
      isRecord(payload) &&
      typeof payload.photoCaptureId === "string" &&
      payload.photoCaptureId.trim().length > 0
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (await isPhotoUploadCompletionRequest(request)) {
    return handleCompletePhotoIngestionRouteRequest(request);
  }

  return handleCreatePhotoCaptureRouteRequest(request);
}
