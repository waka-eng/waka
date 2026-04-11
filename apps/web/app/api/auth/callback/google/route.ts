import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { completeGoogleOAuthCallback } from "../../../../../src/auth/google-callback.ts";

export async function GET(request: NextRequest) {
  const result = await completeGoogleOAuthCallback({
    searchParams: request.nextUrl.searchParams,
  });

  return NextResponse.json(result.body, { status: result.status });
}
