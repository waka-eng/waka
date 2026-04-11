import {
  createCurrentWorkspaceApiKeyScopeResolver,
  MissingCurrentWorkspaceApiKeyScopeError,
  type CurrentWorkspaceApiKeySessionLike,
  type CurrentWorkspaceApiKeySessionProvider,
  type CurrentWorkspaceMembershipLookupClient,
} from "./api-key-current-workspace.ts";
import {
  API_KEY_REVOKE_ID_REQUIRED_ERROR,
  API_KEY_REVOKE_NOT_FOUND_ERROR,
  API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR,
  API_KEY_REVOKE_REQUEST_BODY_JSON_INVALID_ERROR,
  ApiKeyNotFoundError,
  parseRevokeApiKeyRequestBody,
  revokeCurrentWorkspaceApiKeyForResponse,
} from "./api-key-revocation.ts";
import type {
  ApiKeyPersistenceClient,
  RevokeApiKeyOptions,
  StoredApiKeyRecord,
} from "./api-key-persistence.ts";

export const REVOKE_API_KEY_ROUTE_OK_STATUS = 200;
export const REVOKE_API_KEY_ROUTE_BAD_REQUEST_STATUS = 400;
export const REVOKE_API_KEY_ROUTE_UNAUTHORIZED_STATUS = 401;
export const REVOKE_API_KEY_ROUTE_NOT_FOUND_STATUS = 404;
export const REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS = 409;
export const REVOKE_API_KEY_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const REVOKE_API_KEY_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const REVOKE_API_KEY_ROUTE_NOT_FOUND_ERROR = API_KEY_REVOKE_NOT_FOUND_ERROR;
export const REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR =
  "An active workspace membership is required to revoke API keys.";
export const REVOKE_API_KEY_ROUTE_INTERNAL_ERROR = "Internal Server Error";
export const REVOKE_API_KEY_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Revoke API key route dependencies have not been configured.";

export interface RevokeApiKeyRouteErrorResponse {
  error: string;
}

export interface RevokeApiKeyRouteDependencies<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
> {
  apiKeyPersistenceClient: ApiKeyPersistenceClient<TRecord>;
  membershipClient: CurrentWorkspaceMembershipLookupClient;
  sessionProvider: CurrentWorkspaceApiKeySessionProvider<TSession>;
}

export interface HandleRevokeApiKeyRouteRequestOptions<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
> {
  revokeApiKeyOptions?: RevokeApiKeyOptions;
  dependencies?: RevokeApiKeyRouteDependencies<TRecord, TSession>;
}

let defaultRevokeApiKeyRouteDependencies:
  | RevokeApiKeyRouteDependencies
  | null = null;

function createJsonResponse<TBody>(
  body: TBody,
  status: number,
): Response {
  return Response.json(body, {
    status,
  });
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length === 0 ? null : normalizedValue;
}

function hasAuthenticatedSession(
  session: CurrentWorkspaceApiKeySessionLike | null,
): boolean {
  return (
    readNonEmptyString(session?.userId) !== null ||
    readNonEmptyString(session?.user?.id) !== null
  );
}

function isRevokeApiKeyBadRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.endsWith(" must be a string") ||
    error.message === API_KEY_REVOKE_ID_REQUIRED_ERROR ||
    error.message === API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR ||
    error.message.startsWith(API_KEY_REVOKE_REQUEST_BODY_JSON_INVALID_ERROR)
  );
}

function requestHasJsonBody(request: Request): boolean {
  return request.headers.get("content-type")?.includes("application/json") ?? false;
}

function resolveRevokeApiKeyRouteDependencies<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
>(
  override?: RevokeApiKeyRouteDependencies<TRecord, TSession>,
): RevokeApiKeyRouteDependencies<TRecord, TSession> {
  if (override) {
    return override;
  }

  if (defaultRevokeApiKeyRouteDependencies) {
    return defaultRevokeApiKeyRouteDependencies as RevokeApiKeyRouteDependencies<
      TRecord,
      TSession
    >;
  }

  throw new Error(REVOKE_API_KEY_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

export function configureRevokeApiKeyRouteDependencies(
  dependencies: RevokeApiKeyRouteDependencies | null,
): void {
  defaultRevokeApiKeyRouteDependencies = dependencies;
}

export async function parseRevokeApiKeyRouteRequest(
  request: Request,
): Promise<{ apiKeyId: string }> {
  if (!requestHasJsonBody(request)) {
    try {
      return parseRevokeApiKeyRequestBody(
        Object.fromEntries((await request.formData()).entries()),
      );
    } catch (error) {
      if (isRevokeApiKeyBadRequestError(error)) {
        throw error;
      }

      throw new TypeError(API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR);
    }
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${API_KEY_REVOKE_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseRevokeApiKeyRequestBody(payload);
}

export async function handleRevokeApiKeyRouteRequest<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
>(
  request: Request,
  options: HandleRevokeApiKeyRouteRequestOptions<TRecord, TSession> = {},
): Promise<Response> {
  let dependencies: RevokeApiKeyRouteDependencies<TRecord, TSession>;

  try {
    dependencies = resolveRevokeApiKeyRouteDependencies(options.dependencies);
  } catch {
    return createJsonResponse<RevokeApiKeyRouteErrorResponse>(
      {
        error: REVOKE_API_KEY_ROUTE_INTERNAL_ERROR,
      },
      REVOKE_API_KEY_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const session = await dependencies.sessionProvider.getCurrentWorkspaceSession();

  if (!hasAuthenticatedSession(session)) {
    return createJsonResponse<RevokeApiKeyRouteErrorResponse>(
      {
        error: REVOKE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
      },
      REVOKE_API_KEY_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const input = await parseRevokeApiKeyRouteRequest(request);
    const responseBody = await revokeCurrentWorkspaceApiKeyForResponse(
      {
        apiKeyPersistenceClient: dependencies.apiKeyPersistenceClient,
        currentWorkspaceScopeResolver: createCurrentWorkspaceApiKeyScopeResolver({
          membershipClient: dependencies.membershipClient,
          sessionProvider: {
            async getCurrentWorkspaceSession() {
              return session;
            },
          },
        }),
      },
      input,
      options.revokeApiKeyOptions,
    );

    return createJsonResponse(responseBody, REVOKE_API_KEY_ROUTE_OK_STATUS);
  } catch (error) {
    if (error instanceof MissingCurrentWorkspaceApiKeyScopeError) {
      return createJsonResponse<RevokeApiKeyRouteErrorResponse>(
        {
          error: REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
        },
        REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS,
      );
    }

    if (error instanceof ApiKeyNotFoundError) {
      return createJsonResponse<RevokeApiKeyRouteErrorResponse>(
        {
          error: REVOKE_API_KEY_ROUTE_NOT_FOUND_ERROR,
        },
        REVOKE_API_KEY_ROUTE_NOT_FOUND_STATUS,
      );
    }

    if (isRevokeApiKeyBadRequestError(error)) {
      return createJsonResponse<RevokeApiKeyRouteErrorResponse>(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        REVOKE_API_KEY_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse<RevokeApiKeyRouteErrorResponse>(
      {
        error: REVOKE_API_KEY_ROUTE_INTERNAL_ERROR,
      },
      REVOKE_API_KEY_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
