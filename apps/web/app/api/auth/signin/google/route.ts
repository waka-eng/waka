import { NextResponse } from "next/server.js";

import { getAuthEnv } from "../../../../../src/env/auth.ts";
import { getGoogleAuthCallbackUrl } from "../../../../../src/auth/google-callback.ts";
import { GOOGLE_IDENTITY_SCOPES } from "../../../../../src/auth/providers/google.ts";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

export async function GET() {
  const authEnv = getAuthEnv(process.env);
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);

  authorizationUrl.searchParams.set("client_id", authEnv.GOOGLE_CLIENT_ID);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    getGoogleAuthCallbackUrl(authEnv.NEXTAUTH_URL),
  );
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_IDENTITY_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(authorizationUrl, 302);
}
