import { createHash } from "node:crypto";

export const API_KEY_PLAINTEXT_PREFIX = "waka_live_";

export type ApiKeyAuthorizationFailureReason =
  | "missing_authorization_header"
  | "invalid_authorization_scheme"
  | "missing_bearer_token"
  | "malformed_authorization_header"
  | "invalid_api_key"
  | "revoked_api_key";

export interface ParsedApiKeyBearerToken {
  ok: true;
  token: string;
}

export interface FailedApiKeyBearerTokenParse {
  ok: false;
  reason:
    | "missing_authorization_header"
    | "invalid_authorization_scheme"
    | "missing_bearer_token"
    | "malformed_authorization_header";
}

export type ApiKeyBearerTokenParseResult =
  | ParsedApiKeyBearerToken
  | FailedApiKeyBearerTokenParse;

export interface ApiKeyAuthRecord {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

export interface ApiKeyAuthStore {
  findApiKeyByHashedKey(hashedKey: string): Promise<ApiKeyAuthRecord | null>;
  findInactiveApiKeyByHashedKey?(
    hashedKey: string,
  ): Promise<ApiKeyAuthRecord | null>;
  markApiKeyUsed(apiKeyId: string, lastUsedAt: Date): Promise<void>;
}

export interface ApiKeyRequestLike {
  headers: Pick<Headers, "get">;
}

export interface AuthenticatedApiKey {
  apiKeyId: string;
  userId: string;
  token: string;
  hashedKey: string;
  lastUsedAt: Date;
}

export interface AuthenticatedApiKeyRequest {
  ok: true;
  apiKey: AuthenticatedApiKey;
}

export interface RejectedApiKeyRequest {
  ok: false;
  reason: ApiKeyAuthorizationFailureReason;
}

export type ApiKeyRequestAuthResult =
  | AuthenticatedApiKeyRequest
  | RejectedApiKeyRequest;

export interface ApiKeyRouteContext {
  apiKey: AuthenticatedApiKey;
}

export type ApiKeyRouteHandler<TRequest extends ApiKeyRequestLike> = (
  request: TRequest,
  context: ApiKeyRouteContext,
) => Response | Promise<Response>;

export type ApiKeyRouteUnauthorizedHandler = (
  result: RejectedApiKeyRequest,
) => Response | Promise<Response>;

export interface ApiKeyRouteAuthOptions {
  now?: Date | (() => Date);
  onUnauthorized?: ApiKeyRouteUnauthorizedHandler;
}

export const API_KEY_UNAUTHORIZED_STATUS = 401;
export const API_KEY_UNAUTHORIZED_MESSAGE = "Unauthorized";
export const API_KEY_WWW_AUTHENTICATE_HEADER = "Bearer";

export function parseApiKeyBearerToken(
  authorizationHeader: string | null | undefined,
): ApiKeyBearerTokenParseResult {
  if (
    typeof authorizationHeader !== "string" ||
    authorizationHeader.trim().length === 0
  ) {
    return {
      ok: false,
      reason: "missing_authorization_header",
    };
  }

  const segments = authorizationHeader.trim().split(/\s+/u);
  const [scheme, token, ...rest] = segments;

  if (scheme.toLowerCase() !== "bearer") {
    return {
      ok: false,
      reason: "invalid_authorization_scheme",
    };
  }

  if (typeof token !== "string" || token.length === 0) {
    return {
      ok: false,
      reason: "missing_bearer_token",
    };
  }

  if (rest.length > 0) {
    return {
      ok: false,
      reason: "malformed_authorization_header",
    };
  }

  return {
    ok: true,
    token,
  };
}

export function hashApiKey(rawApiKey: string): string {
  return createHash("sha256")
    .update(extractApiKeySecret(rawApiKey), "utf8")
    .digest("hex");
}

export function extractApiKeySecret(rawApiKey: string): string {
  const normalizedApiKey = rawApiKey.trim();

  if (normalizedApiKey.length === 0) {
    throw new Error("API key must be a non-empty string");
  }

  if (!normalizedApiKey.startsWith(API_KEY_PLAINTEXT_PREFIX)) {
    throw new Error(
      `API key must start with ${API_KEY_PLAINTEXT_PREFIX}`,
    );
  }

  const secret = normalizedApiKey.slice(API_KEY_PLAINTEXT_PREFIX.length);

  if (secret.length === 0) {
    throw new Error("API key must include a secret");
  }

  return secret;
}

export async function authenticateApiKeyBearerToken(
  authorizationHeader: string | null | undefined,
  store: ApiKeyAuthStore,
  now: Date = new Date(),
): Promise<ApiKeyRequestAuthResult> {
  const parsedToken = parseApiKeyBearerToken(authorizationHeader);

  if (!parsedToken.ok) {
    return parsedToken;
  }

  const hashedKey = hashApiKey(parsedToken.token);
  const apiKey = await store.findApiKeyByHashedKey(hashedKey);

  if (apiKey === null) {
    if (store.findInactiveApiKeyByHashedKey !== undefined) {
      const inactiveApiKey = await store.findInactiveApiKeyByHashedKey(hashedKey);

      if (inactiveApiKey !== null) {
        return {
          ok: false,
          reason: "revoked_api_key",
        };
      }
    }

    return {
      ok: false,
      reason: "invalid_api_key",
    };
  }

  if (apiKey.revokedAt !== null) {
    return {
      ok: false,
      reason: "revoked_api_key",
    };
  }

  await store.markApiKeyUsed(apiKey.id, now);

  return {
    ok: true,
    apiKey: {
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      token: parsedToken.token,
      hashedKey,
      lastUsedAt: now,
    },
  };
}

export async function authenticateApiKeyRequest(
  request: ApiKeyRequestLike,
  store: ApiKeyAuthStore,
  now: Date = new Date(),
): Promise<ApiKeyRequestAuthResult> {
  return authenticateApiKeyBearerToken(
    request.headers.get("authorization"),
    store,
    now,
  );
}

export function createApiKeyUnauthorizedResponse(): Response {
  return Response.json(
    {
      error: API_KEY_UNAUTHORIZED_MESSAGE,
    },
    {
      status: API_KEY_UNAUTHORIZED_STATUS,
      headers: {
        "WWW-Authenticate": API_KEY_WWW_AUTHENTICATE_HEADER,
      },
    },
  );
}

function resolveApiKeyRouteAuthNow(
  now: ApiKeyRouteAuthOptions["now"],
): Date {
  if (typeof now === "function") {
    return now();
  }

  return now ?? new Date();
}

export function withApiKeyAuth<TRequest extends ApiKeyRequestLike>(
  store: ApiKeyAuthStore,
  handler: ApiKeyRouteHandler<TRequest>,
  options: ApiKeyRouteAuthOptions = {},
): (request: TRequest) => Promise<Response> {
  return async function handleApiKeyAuthenticatedRoute(
    request: TRequest,
  ): Promise<Response> {
    const authResult = await authenticateApiKeyRequest(
      request,
      store,
      resolveApiKeyRouteAuthNow(options.now),
    );

    if (!authResult.ok) {
      if (options.onUnauthorized !== undefined) {
        return options.onUnauthorized(authResult);
      }

      return createApiKeyUnauthorizedResponse();
    }

    return handler(request, {
      apiKey: authResult.apiKey,
    });
  };
}
