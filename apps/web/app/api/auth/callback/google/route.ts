import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { completeGoogleOAuthCallback } from "../../../../../src/auth/google-callback.ts";
import {
  CLI_AUTH_REDIRECT_URI_COOKIE_NAME,
  buildSessionCookieOptions,
  createPersistentAuthSession,
  createPrismaGoogleUserPersistenceClient,
  ensureDefaultWorkspaceForUser,
  isValidCliRedirectUri,
  issueCliAuthApiKeyForUser,
  toRuntimeUserRecord,
} from "../../../../../src/auth/runtime.ts";

export async function GET(request: NextRequest) {
  const requestHost = request.headers.get("host");
  const redirectBaseUrl =
    requestHost === null
      ? request.url
      : `${request.nextUrl.protocol}//${requestHost}`;
  const callbackResult = await completeGoogleOAuthCallback({
    searchParams: request.nextUrl.searchParams,
    userPersistenceClient: createPrismaGoogleUserPersistenceClient(),
  });

  if ("error" in callbackResult.body) {
    const redirectUrl = new URL("/auth/signin", redirectBaseUrl);

    redirectUrl.searchParams.set("error", callbackResult.body.error);
    redirectUrl.searchParams.set(
      "error_description",
      callbackResult.body.errorDescription,
    );

    return NextResponse.redirect(redirectUrl, 302);
  }

  const runtimeUser = toRuntimeUserRecord(callbackResult.body.user);
  await ensureDefaultWorkspaceForUser(runtimeUser);

  const { expires, sessionToken } = await createPersistentAuthSession(
    runtimeUser.id,
  );
  const cliRedirectUri = request.cookies.get(
    CLI_AUTH_REDIRECT_URI_COOKIE_NAME,
  )?.value;
  let response: NextResponse;

  if (
    typeof cliRedirectUri === "string" &&
    cliRedirectUri.trim().length > 0 &&
    isValidCliRedirectUri(cliRedirectUri)
  ) {
    const redirectUrl = new URL(cliRedirectUri);

    redirectUrl.searchParams.set(
      "plainKey",
      await issueCliAuthApiKeyForUser(runtimeUser),
    );
    response = NextResponse.redirect(redirectUrl, 302);
    response.cookies.delete(CLI_AUTH_REDIRECT_URI_COOKIE_NAME);
  } else {
    response = NextResponse.redirect(new URL("/dashboard", redirectBaseUrl), 302);
  }

  const cookieOptions = buildSessionCookieOptions(redirectBaseUrl, expires);

  response.cookies.set({
    ...cookieOptions,
    value: sessionToken,
  });

  return response;
}
