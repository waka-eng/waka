import { NextResponse } from "next/server";

const DEV_SIGN_IN_COOKIE_NAME = "authjs.session-token";
const DEV_SIGN_IN_COOKIE_VALUE = "waka-dev-session";
const DEV_SIGN_IN_REDIRECT_PATH = "/dashboard";

function canUseDevSignIn(requestUrl: string): boolean {
  const { hostname } = new URL(requestUrl);

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0"
  );
}

export async function GET(request: Request) {
  if (!canUseDevSignIn(request.url)) {
    return NextResponse.json(
      {
        error: "Dev sign-in is only available on localhost.",
      },
      { status: 403 },
    );
  }

  const requestUrl = new URL(request.url);
  const requestHost = request.headers.get("host");
  const redirectBaseUrl =
    requestHost === null
      ? request.url
      : `${requestUrl.protocol}//${requestHost}`;

  const response = NextResponse.redirect(
    new URL(DEV_SIGN_IN_REDIRECT_PATH, redirectBaseUrl),
    302,
  );

  response.cookies.set({
    name: DEV_SIGN_IN_COOKIE_NAME,
    value: DEV_SIGN_IN_COOKIE_VALUE,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  });

  return response;
}
