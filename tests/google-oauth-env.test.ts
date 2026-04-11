import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { getAuthEnv } from "../apps/web/src/env/auth.ts";
import {
  GOOGLE_IDENTITY_SCOPES,
  getGoogleProviderConfig,
  mapGoogleProfileToUserClaims,
  mapGoogleProfileToUserModelPayload,
} from "../apps/web/src/auth/providers/google.ts";

test(".env.example documents Google OAuth credentials", () => {
  const envExample = readFileSync(".env.example", "utf8");

  assert.match(envExample, /^GOOGLE_CLIENT_ID=/m);
  assert.match(envExample, /^GOOGLE_CLIENT_SECRET=/m);
});

test("Google provider config is populated from environment variables", () => {
  const env = {
    NEXTAUTH_SECRET: "test-secret",
    NEXTAUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  };

  assert.deepEqual(getAuthEnv(env), env);
  const config = getGoogleProviderConfig(env);

  assert.equal(config.clientId, "google-client-id");
  assert.equal(config.clientSecret, "google-client-secret");
  assert.deepEqual(config.authorization, {
    params: {
      scope: GOOGLE_IDENTITY_SCOPES.join(" "),
    },
  });
  assert.equal(config.profile, mapGoogleProfileToUserClaims);
});

test("Google provider config requests verified identity scopes", () => {
  const { authorization } = getGoogleProviderConfig({
    NEXTAUTH_SECRET: "test-secret",
    NEXTAUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  });

  assert.equal(
    authorization.params.scope,
    "openid email profile",
  );
});

test("Google profile mapping captures verified subject and email claims", () => {
  assert.deepEqual(
    mapGoogleProfileToUserClaims({
      sub: "google-subject-123",
      email: "founder@waka.app",
      email_verified: true,
      name: "Waka Founder",
      picture: "https://example.com/avatar.png",
    }),
    {
      id: "google-subject-123",
      email: "founder@waka.app",
      emailVerified: true,
      name: "Waka Founder",
      image: "https://example.com/avatar.png",
      googleSubject: "google-subject-123",
    },
  );
});

test("Google user model payload mapping captures the stable Google subject key", () => {
  assert.deepEqual(
    mapGoogleProfileToUserModelPayload({
      sub: "google-subject-123",
      email: "founder@waka.app",
      email_verified: true,
      name: "Waka Founder",
      picture: "https://example.com/avatar.png",
    }),
    {
      email: "founder@waka.app",
      name: "Waka Founder",
      image: "https://example.com/avatar.png",
      googleSubject: "google-subject-123",
    },
  );
});

test("Google user model payload mapping trims required fields and nulls blank optional fields", () => {
  assert.deepEqual(
    mapGoogleProfileToUserModelPayload({
      sub: "  google-subject-123  ",
      email: "  founder@waka.app  ",
      email_verified: true,
      name: "   ",
      picture: "",
    }),
    {
      email: "founder@waka.app",
      name: null,
      image: null,
      googleSubject: "google-subject-123",
    },
  );
});

test("Google provider config uses the profile mapper for authenticated identity claims", () => {
  const config = getGoogleProviderConfig({
    NEXTAUTH_SECRET: "test-secret",
    NEXTAUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  });

  assert.deepEqual(
    config.profile({
      sub: "google-subject-123",
      email: "founder@waka.app",
      email_verified: true,
      name: "Waka Founder",
      picture: "https://example.com/avatar.png",
    }),
    {
      id: "google-subject-123",
      email: "founder@waka.app",
      emailVerified: true,
      name: "Waka Founder",
      image: "https://example.com/avatar.png",
      googleSubject: "google-subject-123",
    },
  );
});

test("Google profile mapping rejects missing subject claims", () => {
  assert.throws(
    () =>
      mapGoogleProfileToUserClaims({
        email: "founder@waka.app",
        email_verified: true,
      }),
    /Google profile is missing required claim: sub/,
  );
});

test("Google profile mapping rejects missing email claims", () => {
  assert.throws(
    () =>
      mapGoogleProfileToUserClaims({
        sub: "google-subject-123",
        email_verified: true,
      }),
    /Google profile is missing required claim: email/,
  );
});

test("Google profile mapping rejects unverified Google email addresses", () => {
  assert.throws(
    () =>
      mapGoogleProfileToUserClaims({
        sub: "google-subject-123",
        email: "founder@waka.app",
        email_verified: false,
      }),
    /Google profile email must be verified before creating a user identity/,
  );
});

test("Google provider config rejects missing client ID", () => {
  assert.throws(
    () =>
      getGoogleProviderConfig({
        NEXTAUTH_SECRET: "test-secret",
        NEXTAUTH_URL: "http://localhost:3000",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      }),
    /Missing required environment variable: GOOGLE_CLIENT_ID/,
  );
});

test("Google provider config rejects missing client secret", () => {
  assert.throws(
    () =>
      getGoogleProviderConfig({
        NEXTAUTH_SECRET: "test-secret",
        NEXTAUTH_URL: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "google-client-id",
      }),
    /Missing required environment variable: GOOGLE_CLIENT_SECRET/,
  );
});
