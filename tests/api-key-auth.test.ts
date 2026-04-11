import assert from "node:assert/strict";
import test from "node:test";

import {
  API_KEY_PLAINTEXT_PREFIX,
  API_KEY_UNAUTHORIZED_MESSAGE,
  API_KEY_UNAUTHORIZED_STATUS,
  API_KEY_WWW_AUTHENTICATE_HEADER,
  authenticateApiKeyBearerToken,
  authenticateApiKeyRequest,
  createApiKeyUnauthorizedResponse,
  extractApiKeySecret,
  hashApiKey,
  parseApiKeyBearerToken,
  type ApiKeyAuthRecord,
  type ApiKeyAuthStore,
  withApiKeyAuth,
} from "../apps/web/src/auth/api-key.ts";

class InMemoryApiKeyAuthStore implements ApiKeyAuthStore {
  readonly lastUsedUpdates: Array<{
    apiKeyId: string;
    lastUsedAt: Date;
  }> = [];

  readonly recordsByHashedKey = new Map<string, ApiKeyAuthRecord>();

  constructor(records: Array<{ token: string } & ApiKeyAuthRecord>) {
    for (const record of records) {
      this.recordsByHashedKey.set(hashApiKey(record.token), {
        id: record.id,
        userId: record.userId,
        revokedAt: record.revokedAt,
      });
    }
  }

  async findApiKeyByHashedKey(
    hashedKey: string,
  ): Promise<ApiKeyAuthRecord | null> {
    const record = this.recordsByHashedKey.get(hashedKey) ?? null;

    return record?.revokedAt === null ? record : null;
  }

  async findInactiveApiKeyByHashedKey(
    hashedKey: string,
  ): Promise<ApiKeyAuthRecord | null> {
    const record = this.recordsByHashedKey.get(hashedKey) ?? null;

    return record?.revokedAt === null ? null : record;
  }

  async markApiKeyUsed(apiKeyId: string, lastUsedAt: Date): Promise<void> {
    this.lastUsedUpdates.push({
      apiKeyId,
      lastUsedAt,
    });
  }
}

test("parseApiKeyBearerToken accepts case-insensitive Bearer authorization values", () => {
  assert.deepEqual(
    parseApiKeyBearerToken("bearer waka_live_123"),
    {
      ok: true,
      token: "waka_live_123",
    },
  );
});

test("parseApiKeyBearerToken rejects malformed authorization values", () => {
  assert.deepEqual(parseApiKeyBearerToken(null), {
    ok: false,
    reason: "missing_authorization_header",
  });

  assert.deepEqual(parseApiKeyBearerToken("Basic abc123"), {
    ok: false,
    reason: "invalid_authorization_scheme",
  });

  assert.deepEqual(parseApiKeyBearerToken("Bearer"), {
    ok: false,
    reason: "missing_bearer_token",
  });

  assert.deepEqual(parseApiKeyBearerToken("Bearer waka extra"), {
    ok: false,
    reason: "malformed_authorization_header",
  });
});

test("hashApiKey produces a stable sha256 digest", () => {
  assert.equal(
    hashApiKey("waka_live_123"),
    "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
  );
});

test("extractApiKeySecret returns the hashable secret portion", () => {
  assert.equal(extractApiKeySecret("waka_live_123"), "123");
});

test("extractApiKeySecret rejects malformed API keys", () => {
  assert.throws(
    () => extractApiKeySecret("invalid"),
    new Error(`API key must start with ${API_KEY_PLAINTEXT_PREFIX}`),
  );
  assert.throws(
    () => extractApiKeySecret(API_KEY_PLAINTEXT_PREFIX),
    new Error("API key must include a secret"),
  );
});

test("authenticateApiKeyBearerToken rejects unknown API keys", async () => {
  const result = await authenticateApiKeyBearerToken(
    "Bearer waka_live_missing",
    new InMemoryApiKeyAuthStore([]),
  );

  assert.deepEqual(result, {
    ok: false,
    reason: "invalid_api_key",
  });
});

test("authenticateApiKeyBearerToken rejects revoked API keys without updating usage", async () => {
  const store = new InMemoryApiKeyAuthStore([
    {
      id: "key-1",
      token: "waka_live_revoked",
      userId: "user-1",
      revokedAt: new Date("2026-04-10T00:00:00.000Z"),
    },
  ]);

  const result = await authenticateApiKeyBearerToken(
    "Bearer waka_live_revoked",
    store,
    new Date("2026-04-10T01:00:00.000Z"),
  );

  assert.deepEqual(result, {
    ok: false,
    reason: "revoked_api_key",
  });
  assert.equal(store.lastUsedUpdates.length, 0);
});

test("authenticateApiKeyRequest authenticates a valid API key and records lastUsedAt", async () => {
  const store = new InMemoryApiKeyAuthStore([
    {
      id: "key-2",
      token: "waka_live_valid",
      userId: "user-42",
      revokedAt: null,
    },
  ]);
  const usedAt = new Date("2026-04-10T02:30:00.000Z");

  const result = await authenticateApiKeyRequest(
    new Request("https://waka.app/api/inspirations", {
      headers: {
        Authorization: "Bearer waka_live_valid",
      },
    }),
    store,
    usedAt,
  );

  assert.deepEqual(result, {
    ok: true,
    apiKey: {
      apiKeyId: "key-2",
      userId: "user-42",
      token: "waka_live_valid",
      hashedKey:
        "ec654fac9599f62e79e2706abef23dfb7c07c08185aa86db4d8695f0b718d1b3",
      lastUsedAt: usedAt,
    },
  });
  assert.deepEqual(store.lastUsedUpdates, [
    {
      apiKeyId: "key-2",
      lastUsedAt: usedAt,
    },
  ]);
});

test("createApiKeyUnauthorizedResponse returns a 401 Bearer challenge response", async () => {
  const response = createApiKeyUnauthorizedResponse();

  assert.equal(response.status, API_KEY_UNAUTHORIZED_STATUS);
  assert.equal(
    response.headers.get("www-authenticate"),
    API_KEY_WWW_AUTHENTICATE_HEADER,
  );
  assert.deepEqual(await response.json(), {
    error: API_KEY_UNAUTHORIZED_MESSAGE,
  });
});

test("withApiKeyAuth returns unauthorized when the API key is missing", async () => {
  let handlerCalled = false;

  const handleRequest = withApiKeyAuth(
    new InMemoryApiKeyAuthStore([]),
    async () => {
      handlerCalled = true;
      return Response.json({ ok: true });
    },
  );

  const response = await handleRequest(
    new Request("https://waka.app/api/inspirations"),
  );

  assert.equal(handlerCalled, false);
  assert.equal(response.status, API_KEY_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: API_KEY_UNAUTHORIZED_MESSAGE,
  });
});

test("withApiKeyAuth rejects requests with an invalid Bearer token", async () => {
  let handlerCalled = false;

  const handleRequest = withApiKeyAuth(
    new InMemoryApiKeyAuthStore([]),
    async () => {
      handlerCalled = true;
      return Response.json({ ok: true });
    },
    {
      onUnauthorized: async (result) =>
        Response.json(
          {
            reason: result.reason,
          },
          {
            status: API_KEY_UNAUTHORIZED_STATUS,
          },
        ),
    },
  );

  const response = await handleRequest(
    new Request("https://waka.app/api/inspirations", {
      headers: {
        Authorization: "Bearer waka_live_missing",
      },
    }),
  );

  assert.equal(handlerCalled, false);
  assert.equal(response.status, API_KEY_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    reason: "invalid_api_key",
  });
});

test("withApiKeyAuth rejects requests with a missing Bearer token", async () => {
  let handlerCalled = false;

  const handleRequest = withApiKeyAuth(
    new InMemoryApiKeyAuthStore([]),
    async () => {
      handlerCalled = true;
      return Response.json({ ok: true });
    },
    {
      onUnauthorized: async (result) =>
        Response.json(
          {
            reason: result.reason,
          },
          {
            status: API_KEY_UNAUTHORIZED_STATUS,
          },
        ),
    },
  );

  const response = await handleRequest(
    new Request("https://waka.app/api/inspirations", {
      headers: {
        Authorization: "Bearer",
      },
    }),
  );

  assert.equal(handlerCalled, false);
  assert.equal(response.status, API_KEY_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    reason: "missing_bearer_token",
  });
});

test("withApiKeyAuth rejects requests with a malformed Bearer token", async () => {
  let handlerCalled = false;

  const handleRequest = withApiKeyAuth(
    new InMemoryApiKeyAuthStore([]),
    async () => {
      handlerCalled = true;
      return Response.json({ ok: true });
    },
    {
      onUnauthorized: async (result) =>
        Response.json(
          {
            reason: result.reason,
          },
          {
            status: API_KEY_UNAUTHORIZED_STATUS,
          },
        ),
    },
  );

  const response = await handleRequest(
    new Request("https://waka.app/api/inspirations", {
      headers: {
        Authorization: "Bearer waka_live_valid extra",
      },
    }),
  );

  assert.equal(handlerCalled, false);
  assert.equal(response.status, API_KEY_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    reason: "malformed_authorization_header",
  });
});

test("withApiKeyAuth passes authenticated API key context to the route handler", async () => {
  const store = new InMemoryApiKeyAuthStore([
    {
      id: "key-3",
      token: "waka_live_route",
      userId: "user-route",
      revokedAt: null,
    },
  ]);
  const usedAt = new Date("2026-04-10T03:00:00.000Z");

  const handleRequest = withApiKeyAuth(
    store,
    async (_request, context) =>
      Response.json(
        {
          apiKeyId: context.apiKey.apiKeyId,
          userId: context.apiKey.userId,
          lastUsedAt: context.apiKey.lastUsedAt.toISOString(),
        },
        {
          status: 201,
        },
      ),
    {
      now: usedAt,
    },
  );

  const response = await handleRequest(
    new Request("https://waka.app/api/inspirations", {
      headers: {
        Authorization: "Bearer waka_live_route",
      },
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    apiKeyId: "key-3",
    userId: "user-route",
    lastUsedAt: usedAt.toISOString(),
  });
  assert.deepEqual(store.lastUsedUpdates, [
    {
      apiKeyId: "key-3",
      lastUsedAt: usedAt,
    },
  ]);
});
