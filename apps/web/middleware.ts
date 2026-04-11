import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDashboardRedirectPath } from "./src/auth/dashboard-redirect.ts";

export function middleware(request: NextRequest) {
  const cookieNames = request.cookies.getAll().map(({ name }) => name);
  const redirectPath = getDashboardRedirectPath(cookieNames);

  if (redirectPath === null) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL(redirectPath, request.url), 302);
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*"],
};
