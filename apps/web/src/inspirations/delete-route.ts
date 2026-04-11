import {
  createInspirationRouteNotFoundResponse,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  isInspirationRouteNotFoundError,
} from "./not-found-response.ts";

export const DELETE_INSPIRATION_ROUTE_OK_STATUS = 200;
export const DELETE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS = 400;
export const DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const DELETE_INSPIRATION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const DELETE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const DELETE_INSPIRATION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const DELETE_INSPIRATION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const DELETE_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Delete inspiration route dependencies have not been configured.";
export const DELETE_INSPIRATION_ID_REQUIRED_ERROR =
  "inspirationId must be a non-empty string.";

export interface DeleteInspirationResponseBody {
  deletedAt: string;
  id: string;
}

export interface DeletedInspirationRecord {
  deletedAt: unknown;
  id: unknown;
}

export interface DeleteInspirationPersistenceArgs {
  data: {
    deletedAt: Date;
  };
  select: {
    deletedAt: true;
    id: true;
  };
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface DeleteInspirationPersistenceClient<
  TRecord extends DeletedInspirationRecord = DeletedInspirationRecord,
> {
  inspiration: {
    update(args: DeleteInspirationPersistenceArgs): Promise<TRecord>;
  };
}

export interface DeleteInspirationRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface DeleteInspirationRouteDependencies<
  TRecord extends DeletedInspirationRecord = DeletedInspirationRecord,
> {
  auth: DeleteInspirationRouteAuthResolver;
  persistence: DeleteInspirationPersistenceClient<TRecord>;
}

export interface DeleteInspirationRouteParams {
  inspirationId: string;
}

export interface HandleDeleteInspirationRouteRequestOptions<
  TRecord extends DeletedInspirationRecord = DeletedInspirationRecord,
> {
  dependencies?: DeleteInspirationRouteDependencies<TRecord>;
  params: DeleteInspirationRouteParams;
}

let defaultDeleteInspirationRouteDependencies:
  | DeleteInspirationRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function readRequiredTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function normalizeTimestamp(value: unknown, inspirationId: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Inspiration ${inspirationId} returned an invalid deletedAt value.`,
    );
  }

  return date.toISOString();
}

function resolveDeleteInspirationRouteDependencies<
  TRecord extends DeletedInspirationRecord = DeletedInspirationRecord,
>(
  override?: DeleteInspirationRouteDependencies<TRecord>,
): DeleteInspirationRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultDeleteInspirationRouteDependencies) {
    return defaultDeleteInspirationRouteDependencies as DeleteInspirationRouteDependencies<TRecord>;
  }

  throw new Error(DELETE_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isDeleteInspirationBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === DELETE_INSPIRATION_ID_REQUIRED_ERROR
  );
}

export function configureDeleteInspirationRouteDependencies(
  dependencies: DeleteInspirationRouteDependencies | null,
): void {
  defaultDeleteInspirationRouteDependencies = dependencies;
}

export function buildDeleteInspirationPersistenceArgs(
  userId: string,
  inspirationId: string,
  deletedAt: Date = new Date(),
): DeleteInspirationPersistenceArgs {
  return {
    data: {
      deletedAt,
    },
    select: {
      id: true,
      deletedAt: true,
    },
    where: {
      userId_id: {
        id: readRequiredTrimmedString(inspirationId, "inspirationId"),
        userId: readRequiredTrimmedString(userId, "User id"),
      },
    },
  };
}

export async function deleteInspiration<
  TRecord extends DeletedInspirationRecord = DeletedInspirationRecord,
>(
  client: DeleteInspirationPersistenceClient<TRecord>,
  userId: string,
  inspirationId: string,
  deletedAt: Date = new Date(),
): Promise<DeleteInspirationResponseBody> {
  const record = await client.inspiration.update(
    buildDeleteInspirationPersistenceArgs(userId, inspirationId, deletedAt),
  );

  const normalizedId = readRequiredTrimmedString(
    record.id,
    "Deleted inspiration id",
  );

  return {
    id: normalizedId,
    deletedAt: normalizeTimestamp(record.deletedAt, normalizedId),
  };
}

export async function handleDeleteInspirationRouteRequest<
  TRecord extends DeletedInspirationRecord = DeletedInspirationRecord,
>(
  request: Request,
  options: HandleDeleteInspirationRouteRequestOptions<TRecord>,
): Promise<Response> {
  let dependencies: DeleteInspirationRouteDependencies<TRecord>;

  try {
    dependencies = resolveDeleteInspirationRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: DELETE_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      DELETE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
      },
      DELETE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const deletedInspiration = await deleteInspiration(
      dependencies.persistence,
      authenticatedUserId,
      options.params.inspirationId,
    );

    return createJsonResponse<DeleteInspirationResponseBody>(
      deletedInspiration,
      DELETE_INSPIRATION_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isInspirationRouteNotFoundError(error)) {
      return createInspirationRouteNotFoundResponse();
    }

    if (isDeleteInspirationBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        DELETE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: DELETE_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      DELETE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
