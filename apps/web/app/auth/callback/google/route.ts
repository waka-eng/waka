import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getGoogleCallbackRedirectPath } from "../../../../src/auth/google-callback.ts";

export async function GET(request: NextRequest) {
  const redirectPath = getGoogleCallbackRedirectPath(
    request.nextUrl.searchParams,
  );

  return NextResponse.redirect(new URL(redirectPath, request.url), 302);
}
