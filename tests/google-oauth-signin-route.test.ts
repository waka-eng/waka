import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../apps/web/app/api/auth/signin/google/route.ts";

test("google sign-in route redirects to the Google authorization endpoint", async () => {
  const originalEnv = process.env;

  process.env = {
    ...originalEnv,
    NEXTAUTH_SECRET: "test-secret",
    NEXTAUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  };

  try {
    const response = await GET();

    assert.equal(response.status, 302);

    const location = response.headers.get("location");

    assert.notEqual(location, null);

    const redirectUrl = new URL(location!);

    assert.equal(
      redirectUrl.origin + redirectUrl.pathname,
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    assert.equal(
      redirectUrl.searchParams.get("client_id"),
      "google-client-id",
    );
    assert.equal(
      redirectUrl.searchParams.get("redirect_uri"),
      "http://localhost:3000/auth/callback/google",
    );
    assert.equal(redirectUrl.searchParams.get("response_type"), "code");
    assert.equal(
      redirectUrl.searchParams.get("scope"),
      "openid email profile",
    );
  } finally {
    process.env = originalEnv;
  }
});
