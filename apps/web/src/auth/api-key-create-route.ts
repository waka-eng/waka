import {
  createCurrentWorkspaceApiKeyScopeResolver,
  MissingCurrentWorkspaceApiKeyScopeError,
  type CurrentWorkspaceApiKeySessionLike,
  type CurrentWorkspaceApiKeySessionProvider,
  type CurrentWorkspaceMembershipLookupClient,
} from "./api-key-current-workspace.ts";
import {
  API_KEY_CREATE_DESCRIPTION_INVALID_ERROR,
  API_KEY_CREATE_METADATA_INVALID_ERROR,
  API_KEY_CREATE_NAME_REQUIRED_ERROR,
  API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR,
  API_KEY_CREATE_REQUEST_BODY_JSON_INVALID_ERROR,
  issueCurrentWorkspaceApiKey,
  normalizeCreateApiKeyActionInput,
  parseCreateApiKeyRequestBody,
  type CreateApiKeyRequestBody,
  type CreateApiKeyResponseBody,
} from "./api-key-issuance.ts";
import type {
  ApiKeyPersistenceClient,
  CreateApiKeyOptions,
  StoredApiKeyRecord,
} from "./api-key-persistence.ts";

export const CREATE_API_KEY_ROUTE_CREATED_STATUS = 201;
export const CREATE_API_KEY_ROUTE_BAD_REQUEST_STATUS = 400;
export const CREATE_API_KEY_ROUTE_UNAUTHORIZED_STATUS = 401;
export const CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS = 409;
export const CREATE_API_KEY_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const CREATE_API_KEY_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR =
  "An active workspace membership is required to create API keys.";
export const CREATE_API_KEY_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const CREATE_API_KEY_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Create API key route dependencies have not been configured.";

export interface CreateApiKeyRouteErrorResponse {
  error: string;
}

export interface CreateApiKeyRouteDependencies<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
> {
  apiKeyPersistenceClient: ApiKeyPersistenceClient<TRecord>;
  membershipClient: CurrentWorkspaceMembershipLookupClient;
  sessionProvider: CurrentWorkspaceApiKeySessionProvider<TSession>;
}

export interface HandleCreateApiKeyRouteRequestOptions<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
> {
  createApiKeyOptions?: CreateApiKeyOptions;
  dependencies?: CreateApiKeyRouteDependencies<TRecord, TSession>;
}

let defaultCreateApiKeyRouteDependencies:
  | CreateApiKeyRouteDependencies
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

function isCreateApiKeyBadRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.endsWith(" must be a string") ||
    error.message === API_KEY_CREATE_DESCRIPTION_INVALID_ERROR ||
    error.message === API_KEY_CREATE_METADATA_INVALID_ERROR ||
    error.message === API_KEY_CREATE_NAME_REQUIRED_ERROR ||
    error.message === API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR ||
    error.message.startsWith(API_KEY_CREATE_REQUEST_BODY_JSON_INVALID_ERROR)
  );
}

function requestHasJsonBody(request: Request): boolean {
  return request.headers.get("content-type")?.includes("application/json") ?? false;
}

function resolveCreateApiKeyRouteDependencies<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
>(
  override?: CreateApiKeyRouteDependencies<TRecord, TSession>,
): CreateApiKeyRouteDependencies<TRecord, TSession> {
  if (override) {
    return override;
  }

  if (defaultCreateApiKeyRouteDependencies) {
    return defaultCreateApiKeyRouteDependencies as CreateApiKeyRouteDependencies<
      TRecord,
      TSession
    >;
  }

  throw new Error(CREATE_API_KEY_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

export function configureCreateApiKeyRouteDependencies(
  dependencies: CreateApiKeyRouteDependencies | null,
): void {
  defaultCreateApiKeyRouteDependencies = dependencies;
}

export async function parseCreateApiKeyRouteRequest(
  request: Request,
): Promise<CreateApiKeyRequestBody> {
  if (!requestHasJsonBody(request)) {
    try {
      return normalizeCreateApiKeyActionInput(await request.formData());
    } catch (error) {
      if (isCreateApiKeyBadRequestError(error)) {
        throw error;
      }

      throw new TypeError(API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR);
    }
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${API_KEY_CREATE_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseCreateApiKeyRequestBody(payload);
}

export async function handleCreateApiKeyRouteRequest<
  TRecord extends StoredApiKeyRecord = StoredApiKeyRecord,
  TSession extends CurrentWorkspaceApiKeySessionLike = CurrentWorkspaceApiKeySessionLike,
>(
  request: Request,
  options: HandleCreateApiKeyRouteRequestOptions<TRecord, TSession> = {},
): Promise<Response> {
  let dependencies: CreateApiKeyRouteDependencies<TRecord, TSession>;

  try {
    dependencies = resolveCreateApiKeyRouteDependencies(options.dependencies);
  } catch {
    return createJsonResponse<CreateApiKeyRouteErrorResponse>(
      {
        error: CREATE_API_KEY_ROUTE_INTERNAL_ERROR,
      },
      CREATE_API_KEY_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const session = await dependencies.sessionProvider.getCurrentWorkspaceSession();

  if (!hasAuthenticatedSession(session)) {
    return createJsonResponse<CreateApiKeyRouteErrorResponse>(
      {
        error: CREATE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
      },
      CREATE_API_KEY_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const input = await parseCreateApiKeyRouteRequest(request);
    const responseBody = await issueCurrentWorkspaceApiKey(
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
      options.createApiKeyOptions,
    );

    return createJsonResponse<CreateApiKeyResponseBody>(
      responseBody,
      CREATE_API_KEY_ROUTE_CREATED_STATUS,
    );
  } catch (error) {
    if (error instanceof MissingCurrentWorkspaceApiKeyScopeError) {
      return createJsonResponse<CreateApiKeyRouteErrorResponse>(
        {
          error: CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
        },
        CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS,
      );
    }

    if (isCreateApiKeyBadRequestError(error)) {
      return createJsonResponse<CreateApiKeyRouteErrorResponse>(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        CREATE_API_KEY_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse<CreateApiKeyRouteErrorResponse>(
      {
        error: CREATE_API_KEY_ROUTE_INTERNAL_ERROR,
      },
      CREATE_API_KEY_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
