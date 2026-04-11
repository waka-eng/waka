import { randomUUID } from "node:crypto";

export const UPDATE_CLUSTER_ROUTE_OK_STATUS = 200;
export const UPDATE_CLUSTER_ROUTE_BAD_REQUEST_STATUS = 400;
export const UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_STATUS = 401;
export const UPDATE_CLUSTER_ROUTE_NOT_FOUND_STATUS = 404;
export const UPDATE_CLUSTER_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const UPDATE_CLUSTER_ROUTE_NOT_FOUND_ERROR = "Not Found";
export const UPDATE_CLUSTER_ROUTE_INTERNAL_ERROR = "Internal Server Error";
export const UPDATE_CLUSTER_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Update cluster route dependencies have not been configured.";
export const UPDATE_CLUSTER_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const UPDATE_CLUSTER_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const UPDATE_CLUSTER_REQUEST_BODY_EMPTY_ERROR =
  "At least one updatable field must be provided.";
export const UPDATE_CLUSTER_ID_REQUIRED_ERROR =
  "clusterId must be a non-empty string.";
export const UPDATE_CLUSTER_IS_PUBLIC_INVALID_ERROR =
  "isPublic must be a boolean when provided.";
export const CLUSTER_SHARE_SLUG_GENERATION_MAX_ATTEMPTS = 5;
export const CLUSTER_SHARE_SLUG_PREFIX = "cluster_";

export interface UpdateClusterRequestBody {
  isPublic?: boolean;
  shareSlug?: string | null;
}

export interface UpdateClusterResponseBody {
  id: string;
  isPublic: boolean;
  shareSlug: string | null;
}

export interface UpdatedClusterRecord {
  id: unknown;
  isPublic: unknown;
  shareSlug: unknown;
}

export interface UpdateClusterPersistenceArgs {
  data: {
    isPublic?: boolean;
    shareSlug?: string | null;
  };
  select: {
    id: true;
    isPublic: true;
    shareSlug: true;
  };
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface UpdateClusterPersistenceClient<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
> {
  cluster: {
    update(args: UpdateClusterPersistenceArgs): Promise<TRecord>;
  };
}

export interface UpdateClusterRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export type ClusterShareSlugGenerator = () => string;

export interface UpdateClusterRouteDependencies<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
> {
  auth: UpdateClusterRouteAuthResolver;
  persistence: UpdateClusterPersistenceClient<TRecord>;
  shareSlugGenerator?: ClusterShareSlugGenerator;
}

export interface UpdateClusterRouteParams {
  clusterId: string;
}

export interface HandleUpdateClusterRouteRequestOptions<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
> {
  dependencies?: UpdateClusterRouteDependencies<TRecord>;
  params: UpdateClusterRouteParams;
}

let defaultUpdateClusterRouteDependencies: UpdateClusterRouteDependencies | null =
  null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readOptionalBoolean(
  source: Record<string, unknown>,
  fieldName: string,
  errorMessage: string,
): boolean | undefined {
  const value = source[fieldName];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(errorMessage);
  }

  return value;
}

function readNullableShareSlug(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return readRequiredTrimmedString(value, "Cluster shareSlug");
}

function readRequiredIsPublic(value: unknown, clusterId: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(
      `Cluster ${clusterId} returned an invalid isPublic value.`,
    );
  }

  return value;
}

function resolveShareSlugGenerator<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
>(
  dependencies: UpdateClusterRouteDependencies<TRecord>,
): ClusterShareSlugGenerator {
  return dependencies.shareSlugGenerator ?? generateClusterShareSlug;
}

function isShareSlugConstraintTarget(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.includes("shareSlug");
  }

  return typeof target === "string" && target.includes("shareSlug");
}

function isShareSlugConflictError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  if (
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "target" in error.meta &&
    isShareSlugConstraintTarget(error.meta.target)
  ) {
    return true;
  }

  return "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("shareSlug");
}

function isClusterRouteNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return "code" in error && error.code === "P2025";
}

function resolveUpdateClusterRouteDependencies<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
>(
  override?: UpdateClusterRouteDependencies<TRecord>,
): UpdateClusterRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultUpdateClusterRouteDependencies) {
    return defaultUpdateClusterRouteDependencies as UpdateClusterRouteDependencies<TRecord>;
  }

  throw new Error(UPDATE_CLUSTER_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function normalizeUpdatedClusterResponse<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
>(record: TRecord): UpdateClusterResponseBody {
  const id = readRequiredTrimmedString(record.id, "Updated cluster id");
  const isPublic = readRequiredIsPublic(record.isPublic, id);
  const shareSlug = readNullableShareSlug(record.shareSlug);

  return {
    id,
    isPublic,
    shareSlug,
  };
}

function isUpdateClusterBadRequestError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }

  if (error.message.startsWith(UPDATE_CLUSTER_REQUEST_BODY_JSON_INVALID_ERROR)) {
    return true;
  }

  return [
    UPDATE_CLUSTER_ID_REQUIRED_ERROR,
    UPDATE_CLUSTER_IS_PUBLIC_INVALID_ERROR,
    UPDATE_CLUSTER_REQUEST_BODY_EMPTY_ERROR,
    UPDATE_CLUSTER_REQUEST_BODY_INVALID_ERROR,
  ].includes(error.message);
}

export function configureUpdateClusterRouteDependencies(
  dependencies: UpdateClusterRouteDependencies | null,
): void {
  defaultUpdateClusterRouteDependencies = dependencies;
}

export function generateClusterShareSlug(
  uuidGenerator: () => string = randomUUID,
): string {
  return `${CLUSTER_SHARE_SLUG_PREFIX}${uuidGenerator().replaceAll("-", "")}`;
}

export function buildUpdateClusterPersistenceArgs(
  userId: string,
  clusterId: string,
  input: UpdateClusterRequestBody,
): UpdateClusterPersistenceArgs {
  return {
    data: {
      ...(input.isPublic === undefined ? {} : { isPublic: input.isPublic }),
      ...(input.shareSlug === undefined ? {} : { shareSlug: input.shareSlug }),
    },
    select: {
      id: true,
      isPublic: true,
      shareSlug: true,
    },
    where: {
      userId_id: {
        id: readRequiredTrimmedString(clusterId, "clusterId"),
        userId: readRequiredTrimmedString(userId, "User id"),
      },
    },
  };
}

export async function parseUpdateClusterRequestBody(
  request: Request,
): Promise<UpdateClusterRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${UPDATE_CLUSTER_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(UPDATE_CLUSTER_REQUEST_BODY_INVALID_ERROR);
  }

  const isPublic = readOptionalBoolean(
    payload,
    "isPublic",
    UPDATE_CLUSTER_IS_PUBLIC_INVALID_ERROR,
  );

  if (isPublic === undefined) {
    throw new TypeError(UPDATE_CLUSTER_REQUEST_BODY_EMPTY_ERROR);
  }

  return {
    isPublic,
  };
}

async function updateClusterWithResolvedShareSlug<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
>(
  dependencies: UpdateClusterRouteDependencies<TRecord>,
  userId: string,
  clusterId: string,
  input: UpdateClusterRequestBody,
): Promise<TRecord> {
  if (input.isPublic === undefined) {
    return dependencies.persistence.cluster.update(
      buildUpdateClusterPersistenceArgs(userId, clusterId, input),
    );
  }

  if (input.isPublic === false) {
    return dependencies.persistence.cluster.update(
      buildUpdateClusterPersistenceArgs(userId, clusterId, {
        ...input,
        shareSlug: null,
      }),
    );
  }

  const shareSlugGenerator = resolveShareSlugGenerator(dependencies);
  let latestError: unknown;

  for (
    let attempt = 0;
    attempt < CLUSTER_SHARE_SLUG_GENERATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const shareSlug = shareSlugGenerator();

    try {
      return await dependencies.persistence.cluster.update(
        buildUpdateClusterPersistenceArgs(userId, clusterId, {
          ...input,
          shareSlug,
        }),
      );
    } catch (error) {
      if (!isShareSlugConflictError(error)) {
        throw error;
      }

      latestError = error;
    }
  }

  throw latestError;
}

export async function handleUpdateClusterRouteRequest<
  TRecord extends UpdatedClusterRecord = UpdatedClusterRecord,
>(
  request: Request,
  options: HandleUpdateClusterRouteRequestOptions<TRecord>,
): Promise<Response> {
  let dependencies: UpdateClusterRouteDependencies<TRecord>;

  try {
    dependencies = resolveUpdateClusterRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: UPDATE_CLUSTER_ROUTE_INTERNAL_ERROR,
      },
      UPDATE_CLUSTER_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_ERROR,
      },
      UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const clusterId = readRequiredTrimmedString(
      options.params.clusterId,
      "clusterId",
    );
    const requestBody = await parseUpdateClusterRequestBody(request);
    const updatedCluster = await updateClusterWithResolvedShareSlug(
      dependencies,
      authenticatedUserId,
      clusterId,
      requestBody,
    );

    return createJsonResponse(
      normalizeUpdatedClusterResponse(updatedCluster),
      UPDATE_CLUSTER_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isClusterRouteNotFoundError(error)) {
      return createJsonResponse(
        {
          error: UPDATE_CLUSTER_ROUTE_NOT_FOUND_ERROR,
        },
        UPDATE_CLUSTER_ROUTE_NOT_FOUND_STATUS,
      );
    }

    if (isUpdateClusterBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        UPDATE_CLUSTER_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: UPDATE_CLUSTER_ROUTE_INTERNAL_ERROR,
      },
      UPDATE_CLUSTER_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
