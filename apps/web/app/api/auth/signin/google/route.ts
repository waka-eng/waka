import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

import { getAuthEnv } from "../../../../../src/env/auth.ts";
import { getGoogleAuthCallbackUrl } from "../../../../../src/auth/google-callback.ts";
import { GOOGLE_IDENTITY_SCOPES } from "../../../../../src/auth/providers/google.ts";
import {
  CLI_AUTH_REDIRECT_URI_COOKIE_NAME,
  isValidCliRedirectUri,
} from "../../../../../src/auth/runtime.ts";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

export async function GET(request?: NextRequest) {
  const authEnv = getAuthEnv(process.env);
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  const cliRedirectUri =
    request?.nextUrl.searchParams.get("cli_redirect_uri") ?? null;

  authorizationUrl.searchParams.set("client_id", authEnv.GOOGLE_CLIENT_ID);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    getGoogleAuthCallbackUrl(authEnv.NEXTAUTH_URL),
  );
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_IDENTITY_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");

  const response = NextResponse.redirect(authorizationUrl, 302);

  if (
    request &&
    typeof cliRedirectUri === "string" &&
    cliRedirectUri.trim().length > 0 &&
    isValidCliRedirectUri(cliRedirectUri)
  ) {
    response.cookies.set({
      httpOnly: true,
      maxAge: 10 * 60,
      name: CLI_AUTH_REDIRECT_URI_COOKIE_NAME,
      path: "/",
      sameSite: "lax",
      secure: false,
      value: cliRedirectUri.trim(),
    });
  }

  return response;
}
