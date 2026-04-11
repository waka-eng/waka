import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type {
  GoogleAccountUpsertArgs,
  GoogleUserPersistenceClient,
  GoogleUserUpsertArgs,
} from "../apps/web/src/auth/google-user-persistence.ts";
import type { GoogleUserModelPayload } from "../apps/web/src/auth/providers/google.ts";
import {
  GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION,
  GOOGLE_CALLBACK_MISSING_CODE_ERROR,
  GOOGLE_OAUTH_JWKS_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  completeGoogleOAuthCallback,
  exchangeGoogleCallbackForTokens,
  exchangeGoogleCallbackForVerifiedIdentity,
  verifyGoogleIdentityClaims,
} from "../apps/web/src/auth/google-callback.ts";
import {
  createNeonGoogleAuthFixture,
  createNeonGoogleUserPayload,
  getNeonGoogleAuthFixtureSkipReason,
} from "./helpers/neon-google-auth-fixture.ts";

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeBufferBase64Url(value: BufferSource): string {
  return Buffer.from(value as ArrayBuffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createGoogleIdToken(
  claims: Record<string, unknown>,
): Promise<{
  idToken: string;
  jwks: {
    keys: JsonWebKey[];
  };
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const keyId = "test-google-key";
  const encodedHeader = encodeBase64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }),
  );
  const encodedPayload = encodeBase64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  return {
    idToken: `${signingInput}.${encodeBufferBase64Url(signature)}`,
    jwks: {
      keys: [
        {
          ...publicJwk,
          alg: "RS256",
          kid: keyId,
          use: "sig",
        },
      ],
    },
  };
}

interface PersistedGoogleUserRecord extends GoogleUserModelPayload {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PersistedGoogleAccountRecord {
  accessToken: string;
  createdAt: Date;
  expiresAt: number;
  id: string;
  idToken: string;
  provider: "google";
  providerAccountId: string;
  refreshToken: string | null;
  scope: string | null;
  sessionState: string | null;
  tokenType: string;
  type: "oauth";
  updatedAt: Date;
  userId: string;
}

function createPersistedGoogleUserRecord(
  overrides: Partial<PersistedGoogleUserRecord> = {},
): PersistedGoogleUserRecord {
  const timestamp = new Date("2026-04-10T00:00:00.000Z");

  return {
    id: "user-1",
    googleSubject: "google-subject-123",
    email: "founder@waka.app",
    name: "Waka Founder",
    image: "https://example.com/avatar.png",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createFakeGoogleUserPersistenceClient(
  initialUsers: PersistedGoogleUserRecord[] = [],
): {
  accountsByProviderAccountId: Map<string, PersistedGoogleAccountRecord>;
  client: GoogleUserPersistenceClient<PersistedGoogleUserRecord>;
  recordedAccountUpserts: GoogleAccountUpsertArgs[];
  recordedUpserts: GoogleUserUpsertArgs[];
  usersByGoogleSubject: Map<string, PersistedGoogleUserRecord>;
} {
  const usersByGoogleSubject = new Map(
    initialUsers.map((user) => [user.googleSubject, user]),
  );
  const accountsByProviderAccountId = new Map<
    string,
    PersistedGoogleAccountRecord
  >();
  const recordedAccountUpserts: GoogleAccountUpsertArgs[] = [];
  const recordedUpserts: GoogleUserUpsertArgs[] = [];

  const client: GoogleUserPersistenceClient<PersistedGoogleUserRecord> = {
    account: {
      async upsert(args) {
        recordedAccountUpserts.push(args);

        const existingAccount = accountsByProviderAccountId.get(
          args.where.providerAccountId,
        );

        if (existingAccount) {
          const updatedAccount = {
            ...existingAccount,
            ...args.update,
            updatedAt: new Date("2026-04-10T00:00:03.000Z"),
          };

          accountsByProviderAccountId.set(
            existingAccount.providerAccountId,
            updatedAccount,
          );

          return updatedAccount;
        }

        const createdAccount = {
          id: `account-${accountsByProviderAccountId.size + 1}`,
          ...args.create,
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: new Date("2026-04-10T00:00:00.000Z"),
        };

        accountsByProviderAccountId.set(
          createdAccount.providerAccountId,
          createdAccount,
        );

        return createdAccount;
      },
    },
    user: {
      async upsert(args) {
        recordedUpserts.push(args);

        const existingUser = usersByGoogleSubject.get(args.where.googleSubject);

        if (existingUser) {
          const updatedUser = {
            ...existingUser,
            ...args.update,
            updatedAt: new Date("2026-04-10T00:00:03.000Z"),
          };

          usersByGoogleSubject.set(existingUser.googleSubject, updatedUser);

          return updatedUser;
        }

        const createdUser = {
          id: `user-${usersByGoogleSubject.size + 1}`,
          ...args.create,
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: new Date("2026-04-10T00:00:00.000Z"),
        };

        usersByGoogleSubject.set(createdUser.googleSubject, createdUser);

        return createdUser;
      },
    },
  };

  return {
    accountsByProviderAccountId,
    client,
    recordedAccountUpserts,
    recordedUpserts,
    usersByGoogleSubject,
  };
}

function createJsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createMockGoogleOAuthFetch(idToken: {
  idToken: string;
  jwks: {
    keys: JsonWebKey[];
  };
}, tokenOverrides?: {
  accessToken?: string;
  expiresIn?: number;
  refreshToken?: string | null;
  scope?: string | null;
  tokenType?: string;
}): typeof fetch {
  const tokenResponse = {
    accessToken: "google-access-token",
    expiresIn: 3600,
    refreshToken: null,
    scope: "openid email profile",
    tokenType: "Bearer",
    ...tokenOverrides,
  };

  return async (input) => {
    const url = String(input);

    if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) {
      return createJsonResponse({
        access_token: tokenResponse.accessToken,
        expires_in: tokenResponse.expiresIn,
        id_token: idToken.idToken,
        refresh_token: tokenResponse.refreshToken,
        scope: tokenResponse.scope,
        token_type: tokenResponse.tokenType,
      });
    }

    if (url === GOOGLE_OAUTH_JWKS_ENDPOINT) {
      return createJsonResponse(idToken.jwks);
    }

    throw new Error(`Unexpected fetch target: ${url}`);
  };
}

test("Google callback exchange posts the authorization code and returns verified identity claims", async () => {
  let capturedRequestUrl = "";
  let capturedRequestInit: RequestInit | undefined;
  const idToken = await createGoogleIdToken({
    iss: "https://accounts.google.com",
    aud: "google-client-id",
    azp: "google-client-id",
    sub: "google-subject-123",
    email: "founder@waka.app",
    email_verified: true,
    name: "Waka Founder",
    picture: "https://example.com/avatar.png",
    iat: 1_700_000_000,
    exp: 4_102_444_800,
  });

  const result = await exchangeGoogleCallbackForVerifiedIdentity({
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    code: "oauth-code",
    redirectUri: "https://waka.app/auth/callback/google",
    fetch: async (input, init) => {
      const url = String(input);

      if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) {
        capturedRequestUrl = url;
        capturedRequestInit = init;

        return createJsonResponse({
          access_token: "google-access-token",
          expires_in: 3600,
          id_token: idToken.idToken,
          refresh_token: "google-refresh-token",
          scope: "openid email profile",
          token_type: "Bearer",
        });
      }

      if (url === GOOGLE_OAUTH_JWKS_ENDPOINT) {
        return createJsonResponse(idToken.jwks);
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
  });

  assert.equal(capturedRequestUrl, GOOGLE_OAUTH_TOKEN_ENDPOINT);
  assert.equal(capturedRequestInit?.method, "POST");
  assert.deepEqual(capturedRequestInit?.headers, {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  });

  const requestBody = new URLSearchParams(String(capturedRequestInit?.body));

  assert.equal(requestBody.get("client_id"), "google-client-id");
  assert.equal(requestBody.get("client_secret"), "google-client-secret");
  assert.equal(requestBody.get("code"), "oauth-code");
  assert.equal(requestBody.get("grant_type"), "authorization_code");
  assert.equal(
    requestBody.get("redirect_uri"),
    "https://waka.app/auth/callback/google",
  );

  assert.deepEqual(result.user, {
    id: "google-subject-123",
    email: "founder@waka.app",
    emailVerified: true,
    name: "Waka Founder",
    image: "https://example.com/avatar.png",
    googleSubject: "google-subject-123",
  });
  assert.equal(result.tokens.refreshToken, "google-refresh-token");
  assert.equal(result.tokens.scope, "openid email profile");
  assert.equal(result.claims.aud, "google-client-id");
});

test("Google callback exchange surfaces token endpoint failures", async () => {
  await assert.rejects(
    () =>
      exchangeGoogleCallbackForTokens({
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        code: "oauth-code",
        redirectUri: "https://waka.app/auth/callback/google",
        fetch: async () =>
          createJsonResponse(
            {
              error: "invalid_grant",
              error_description: "Expired authorization code",
            },
            400,
          ),
      }),
    /Google token exchange failed with status 400: invalid_grant: Expired authorization code/,
  );
});

test("Google identity claim verification rejects client mismatches", () => {
  assert.throws(
    () =>
      verifyGoogleIdentityClaims({
        clientId: "google-client-id",
        claims: {
          iss: "https://accounts.google.com",
          aud: "different-client-id",
          sub: "google-subject-123",
          email: "founder@waka.app",
          email_verified: true,
          exp: 4_102_444_800,
        },
      }),
    /Google identity token audience does not match the client/,
  );
});

test("Google OAuth callback completion returns verified identity details", async () => {
  const idToken = await createGoogleIdToken({
    iss: "https://accounts.google.com",
    aud: "google-client-id",
    sub: "google-subject-123",
    email: "founder@waka.app",
    email_verified: true,
    name: "Waka Founder",
    picture: "https://example.com/avatar.png",
    iat: 1_700_000_000,
    exp: 4_102_444_800,
  });

  const result = await completeGoogleOAuthCallback({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    fetch: async (input, init) => {
      const url = String(input);

      if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) {
        const requestBody = new URLSearchParams(String(init?.body));

        assert.equal(
          requestBody.get("redirect_uri"),
          "https://waka.app/auth/callback/google",
        );

        return createJsonResponse({
          access_token: "google-access-token",
          expires_in: 3600,
          id_token: idToken.idToken,
          scope: "openid email profile",
          token_type: "Bearer",
        });
      }

      if (url === GOOGLE_OAUTH_JWKS_ENDPOINT) {
        return createJsonResponse(idToken.jwks);
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
    searchParams: new URLSearchParams("code=oauth-code"),
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    provider: "google",
    user: {
      id: "google-subject-123",
      email: "founder@waka.app",
      emailVerified: true,
      name: "Waka Founder",
      image: "https://example.com/avatar.png",
      googleSubject: "google-subject-123",
    },
    claims: {
      iss: "https://accounts.google.com",
      aud: "google-client-id",
      sub: "google-subject-123",
      email: "founder@waka.app",
      email_verified: true,
      name: "Waka Founder",
      picture: "https://example.com/avatar.png",
      iat: 1_700_000_000,
      exp: 4_102_444_800,
    },
    tokens: {
      expiresIn: 3600,
      scope: "openid email profile",
      tokenType: "Bearer",
      hasRefreshToken: false,
    },
  });
});

test("Google OAuth callback completion persists a user on first Google login", async () => {
  const idToken = await createGoogleIdToken({
    iss: "https://accounts.google.com",
    aud: "google-client-id",
    sub: "google-subject-123",
    email: "founder@waka.app",
    email_verified: true,
    name: "Waka Founder",
    picture: "https://example.com/avatar.png",
    iat: 1_700_000_000,
    exp: 4_102_444_800,
  });
  const {
    accountsByProviderAccountId,
    client,
    recordedAccountUpserts,
    recordedUpserts,
    usersByGoogleSubject,
  } =
    createFakeGoogleUserPersistenceClient();

  const result = await completeGoogleOAuthCallback({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    fetch: async (input) => {
      const url = String(input);

      if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) {
        return createJsonResponse({
          access_token: "google-access-token",
          expires_in: 3600,
          id_token: idToken.idToken,
          scope: "openid email profile",
          token_type: "Bearer",
        });
      }

      if (url === GOOGLE_OAUTH_JWKS_ENDPOINT) {
        return createJsonResponse(idToken.jwks);
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
    searchParams: new URLSearchParams("code=oauth-code"),
    userPersistenceClient: client,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.user.id, "user-1");
  assert.equal(result.body.user.googleSubject, "google-subject-123");
  assert.equal(recordedUpserts.length, 1);
  assert.equal(recordedAccountUpserts.length, 1);
  assert.deepEqual(usersByGoogleSubject.get("google-subject-123"), {
    id: "user-1",
    googleSubject: "google-subject-123",
    email: "founder@waka.app",
    name: "Waka Founder",
    image: "https://example.com/avatar.png",
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
  });

  const persistedAccount = accountsByProviderAccountId.get("google-subject-123");

  assert.ok(persistedAccount);
  assert.equal(persistedAccount.userId, "user-1");
  assert.equal(persistedAccount.type, "oauth");
  assert.equal(persistedAccount.provider, "google");
  assert.equal(persistedAccount.providerAccountId, "google-subject-123");
  assert.equal(persistedAccount.accessToken, "google-access-token");
  assert.equal(persistedAccount.refreshToken, null);
  assert.equal(persistedAccount.tokenType, "Bearer");
  assert.equal(persistedAccount.scope, "openid email profile");
  assert.equal(persistedAccount.idToken, idToken.idToken);
  assert.equal(persistedAccount.sessionState, null);
  assert.ok(persistedAccount.expiresAt > 0);
  assert.equal(
    persistedAccount.createdAt.toISOString(),
    "2026-04-10T00:00:00.000Z",
  );
  assert.equal(
    persistedAccount.updatedAt.toISOString(),
    "2026-04-10T00:00:00.000Z",
  );
});

test("Google OAuth callback completion updates the existing user on subsequent Google logins", async () => {
  const idToken = await createGoogleIdToken({
    iss: "https://accounts.google.com",
    aud: "google-client-id",
    sub: "google-subject-123",
    email: "new-email@waka.app",
    email_verified: true,
    name: null,
    picture: null,
    iat: 1_700_000_000,
    exp: 4_102_444_800,
  });
  const existingUser = createPersistedGoogleUserRecord({
    email: "old-email@waka.app",
    name: "Old Name",
    image: "https://example.com/old-avatar.png",
  });
  const { client, recordedUpserts, usersByGoogleSubject } =
    createFakeGoogleUserPersistenceClient([existingUser]);

  const result = await completeGoogleOAuthCallback({
    env: {
      NEXTAUTH_SECRET: "test-secret",
      NEXTAUTH_URL: "https://waka.app",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    fetch: async (input) => {
      const url = String(input);

      if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) {
        return createJsonResponse({
          access_token: "google-access-token",
          expires_in: 3600,
          id_token: idToken.idToken,
          scope: "openid email profile",
          token_type: "Bearer",
        });
      }

      if (url === GOOGLE_OAUTH_JWKS_ENDPOINT) {
        return createJsonResponse(idToken.jwks);
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
    searchParams: new URLSearchParams("code=oauth-code"),
    userPersistenceClient: client,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.user.id, existingUser.id);
  assert.equal(result.body.user.googleSubject, existingUser.googleSubject);
  assert.equal(recordedUpserts.length, 1);
  assert.deepEqual(usersByGoogleSubject.get("google-subject-123"), {
    ...existingUser,
    email: "new-email@waka.app",
    name: null,
    image: null,
    updatedAt: new Date("2026-04-10T00:00:03.000Z"),
  });
});

test(
  "Google OAuth callback completion upserts the existing Neon user and account rows on repeated login without duplicates",
  {
    skip: getNeonGoogleAuthFixtureSkipReason() ?? false,
  },
  async (t) => {
    const fixture = await createNeonGoogleAuthFixture();

    t.after(async () => {
      await fixture.dispose();
    });

    const firstLoginPayload = createNeonGoogleUserPayload();
    const firstLoginToken = await createGoogleIdToken({
      iss: "https://accounts.google.com",
      aud: "google-client-id",
      sub: firstLoginPayload.googleSubject,
      email: firstLoginPayload.email,
      email_verified: true,
      name: firstLoginPayload.name,
      picture: firstLoginPayload.image,
      iat: 1_700_000_000,
      exp: 4_102_444_800,
    });

    const firstLoginResult = await completeGoogleOAuthCallback({
      env: {
        NEXTAUTH_SECRET: "test-secret",
        NEXTAUTH_URL: "https://waka.app",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      },
      fetch: createMockGoogleOAuthFetch(firstLoginToken),
      searchParams: new URLSearchParams("code=oauth-code"),
      userPersistenceClient: fixture.userPersistenceClient,
    });

    assert.equal(firstLoginResult.status, 200);

    const createdUser = await fixture.readUserByGoogleSubject(
      firstLoginPayload.googleSubject,
    );

    assert.ok(createdUser);
    assert.equal(firstLoginResult.body.user.id, createdUser.id);
    assert.equal(
      firstLoginResult.body.user.googleSubject,
      firstLoginPayload.googleSubject,
    );
    assert.equal(createdUser.googleSubject, firstLoginPayload.googleSubject);
    assert.equal(createdUser.email, firstLoginPayload.email);
    assert.equal(createdUser.name, firstLoginPayload.name);
    assert.equal(createdUser.image, firstLoginPayload.image);
    assert.ok(createdUser.id.length > 0);
    assert.ok(createdUser.createdAt.length > 0);
    assert.ok(createdUser.updatedAt.length > 0);
    assert.equal(
      await fixture.countUsersByGoogleSubject(firstLoginPayload.googleSubject),
      1,
    );

    const createdAccount = await fixture.readGoogleAccountByProviderAccountId(
      firstLoginPayload.googleSubject,
    );

    assert.ok(createdAccount);
    assert.equal(createdAccount.userId, createdUser.id);
    assert.equal(createdAccount.type, "oauth");
    assert.equal(createdAccount.provider, "google");
    assert.equal(
      createdAccount.providerAccountId,
      firstLoginPayload.googleSubject,
    );
    assert.equal(createdAccount.accessToken, "google-access-token");
    assert.equal(createdAccount.refreshToken, null);
    assert.ok(createdAccount.expiresAt !== null);
    assert.ok(createdAccount.expiresAt > 0);
    assert.equal(createdAccount.tokenType, "Bearer");
    assert.equal(createdAccount.scope, "openid email profile");
    assert.equal(createdAccount.idToken, firstLoginToken.idToken);
    assert.equal(createdAccount.sessionState, null);
    assert.ok(createdAccount.id.length > 0);
    assert.ok(createdAccount.createdAt.length > 0);
    assert.ok(createdAccount.updatedAt.length > 0);
    assert.equal(
      await fixture.countGoogleAccountsByProviderAccountId(
        firstLoginPayload.googleSubject,
      ),
      1,
    );

    await delay(20);

    const secondLoginPayload = {
      ...firstLoginPayload,
      email: `updated-${firstLoginPayload.email}`,
      image: null,
      name: null,
    };
    const secondLoginAccessToken = "rotated-google-access-token";
    const secondLoginRefreshToken = "rotated-google-refresh-token";
    const secondLoginScope =
      "openid email profile https://www.googleapis.com/auth/calendar.readonly";
    const secondLoginToken = await createGoogleIdToken({
      iss: "https://accounts.google.com",
      aud: "google-client-id",
      sub: secondLoginPayload.googleSubject,
      email: secondLoginPayload.email,
      email_verified: true,
      name: secondLoginPayload.name,
      picture: secondLoginPayload.image,
      iat: 1_700_000_010,
      exp: 4_102_444_800,
    });

    const secondLoginResult = await completeGoogleOAuthCallback({
      env: {
        NEXTAUTH_SECRET: "test-secret",
        NEXTAUTH_URL: "https://waka.app",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      },
      fetch: createMockGoogleOAuthFetch(secondLoginToken, {
        accessToken: secondLoginAccessToken,
        expiresIn: 7200,
        refreshToken: secondLoginRefreshToken,
        scope: secondLoginScope,
      }),
      searchParams: new URLSearchParams("code=oauth-code"),
      userPersistenceClient: fixture.userPersistenceClient,
    });

    assert.equal(secondLoginResult.status, 200);
    assert.equal(secondLoginResult.body.user.id, createdUser.id);
    assert.equal(
      secondLoginResult.body.user.googleSubject,
      secondLoginPayload.googleSubject,
    );

    const updatedUser = await fixture.readUserByGoogleSubject(
      secondLoginPayload.googleSubject,
    );

    assert.ok(updatedUser);
    assert.equal(updatedUser.id, createdUser.id);
    assert.equal(updatedUser.googleSubject, secondLoginPayload.googleSubject);
    assert.equal(updatedUser.email, secondLoginPayload.email);
    assert.equal(updatedUser.name, null);
    assert.equal(updatedUser.image, null);
    assert.equal(updatedUser.createdAt, createdUser.createdAt);
    assert.notEqual(updatedUser.updatedAt, createdUser.updatedAt);
    assert.equal(
      await fixture.countUsersByGoogleSubject(secondLoginPayload.googleSubject),
      1,
    );

    const updatedAccount = await fixture.readGoogleAccountByProviderAccountId(
      secondLoginPayload.googleSubject,
    );

    assert.ok(updatedAccount);
    assert.equal(updatedAccount.id, createdAccount.id);
    assert.equal(updatedAccount.userId, createdUser.id);
    assert.equal(updatedAccount.type, "oauth");
    assert.equal(updatedAccount.provider, "google");
    assert.equal(
      updatedAccount.providerAccountId,
      secondLoginPayload.googleSubject,
    );
    assert.equal(updatedAccount.accessToken, secondLoginAccessToken);
    assert.equal(updatedAccount.refreshToken, secondLoginRefreshToken);
    assert.equal(updatedAccount.scope, secondLoginScope);
    assert.equal(updatedAccount.tokenType, "Bearer");
    assert.equal(updatedAccount.idToken, secondLoginToken.idToken);
    assert.equal(updatedAccount.sessionState, null);
    assert.equal(updatedAccount.createdAt, createdAccount.createdAt);
    assert.notEqual(updatedAccount.updatedAt, createdAccount.updatedAt);
    assert.ok(updatedAccount.expiresAt !== null);
    assert.ok(updatedAccount.expiresAt > createdAccount.expiresAt);
    assert.equal(
      await fixture.countGoogleAccountsByProviderAccountId(
        secondLoginPayload.googleSubject,
      ),
      1,
    );
  },
);

test("Google OAuth callback completion rejects missing authorization codes", async () => {
  const result = await completeGoogleOAuthCallback({
    searchParams: new URLSearchParams(),
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, {
    error: GOOGLE_CALLBACK_MISSING_CODE_ERROR,
    errorDescription: GOOGLE_CALLBACK_MISSING_CODE_DESCRIPTION,
  });
});
