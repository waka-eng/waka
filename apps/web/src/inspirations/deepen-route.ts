import type { SupportedSqsJobPayload } from "../../../../packages/shared/types.ts";
import {
  buildCreateInspirationProcessingState,
  buildCreateInspirationPersistenceArgs,
  type CreateInspirationBackgroundScheduler,
  type CreateInspirationPersistenceArgs,
  type CreateInspirationResponseBody,
  type CreatedInspirationRecord,
} from "./create-route.ts";
import {
  enqueueInspirationEnrichmentJob,
  type InspirationEnrichmentPipelinePersistenceClient,
} from "./enrichment-pipeline.ts";
import {
  createInspirationRouteNotFoundResponse,
  InspirationRouteNotFoundError,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
} from "./not-found-response.ts";

export const DEEPEN_INSPIRATION_ROUTE_CREATED_STATUS = 201;
export const DEEPEN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS = 400;
export const DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const DEEPEN_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const DEEPEN_INSPIRATION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const DEEPEN_INSPIRATION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const DEEPEN_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Deepen inspiration route dependencies have not been configured.";
export const DEEPEN_INSPIRATION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const DEEPEN_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const DEEPEN_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR =
  "rawContent must be at least 1 character.";
export const DEEPEN_INSPIRATION_ID_REQUIRED_ERROR =
  "inspirationId must be a non-empty string.";

export const DEEPEN_INSPIRATION_CHILD_SOURCE_TYPE = "TEXT_NOTE";

export interface DeepenInspirationRequestBody {
  rawContent: string;
}

export interface DeepenInspirationResponseBody
  extends CreateInspirationResponseBody {
  childId: string;
  sourceParentId: string;
}

export interface ParentInspirationRecord {
  clusterId?: unknown;
  id: unknown;
  sourceParentId?: unknown;
}

export interface ReadParentInspirationPersistenceArgs {
  select: {
    clusterId: true;
    id: true;
    sourceParentId: true;
  };
  where: {
    deletedAt: null;
    id: string;
    userId: string;
  };
}

export interface DeepenInspirationPersistenceClient<
  TParentRecord extends ParentInspirationRecord = ParentInspirationRecord,
  TCreatedRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
> {
  inspiration: {
    create(args: CreateInspirationPersistenceArgs): Promise<TCreatedRecord>;
    findFirst(
      args: ReadParentInspirationPersistenceArgs,
    ): Promise<TParentRecord | null>;
  };
}

export interface DeepenInspirationRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface DeepenInspirationQueuePublisher {
  enqueue(payload: SupportedSqsJobPayload): Promise<void>;
}

export interface DeepenInspirationRouteDependencies<
  TParentRecord extends ParentInspirationRecord = ParentInspirationRecord,
  TCreatedRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
> {
  auth: DeepenInspirationRouteAuthResolver;
  backgroundScheduler?: CreateInspirationBackgroundScheduler;
  enrichmentPipeline: InspirationEnrichmentPipelinePersistenceClient;
  logger?: Pick<Console, "error">;
  persistence: DeepenInspirationPersistenceClient<TParentRecord, TCreatedRecord>;
  queuePublisher: DeepenInspirationQueuePublisher;
}

export interface DeepenInspirationRouteParams {
  inspirationId: string;
}

export interface HandleDeepenInspirationRouteRequestOptions<
  TParentRecord extends ParentInspirationRecord = ParentInspirationRecord,
  TCreatedRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
> {
  dependencies?: DeepenInspirationRouteDependencies<TParentRecord, TCreatedRecord>;
  params: DeepenInspirationRouteParams;
}

let defaultDeepenInspirationRouteDependencies:
  | DeepenInspirationRouteDependencies
  | null = null;

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

function stripDeepenOwnedFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    ownerId: _ownerId,
    userId: _userId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    parentId: _parentId,
    sourceParentId: _sourceParentId,
    clusterId: _clusterId,
    sourceType: _sourceType,
    ...sanitizedPayload
  } = payload;

  return sanitizedPayload;
}

function readRequiredRawContent(value: unknown): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new TypeError(DEEPEN_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR);
  }

  return value;
}

function readParentClusterId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return readRequiredTrimmedString(value, "Parent inspiration clusterId");
}

function readSourceParentId(
  value: unknown,
  fallbackParentId: string,
): string {
  if (value === undefined || value === null) {
    return fallbackParentId;
  }

  return readRequiredTrimmedString(
    value,
    "Parent inspiration sourceParentId",
  );
}

function readParentInspirationId(
  params: DeepenInspirationRouteParams,
): string {
  return readRequiredTrimmedString(params.inspirationId, "inspirationId");
}

function buildSourceParentEmbeddingRefreshJobPayload(
  sourceParentId: string,
): SupportedSqsJobPayload {
  return {
    jobType: "reflection_reembedding",
    inspirationId: readRequiredTrimmedString(
      sourceParentId,
      "Created inspiration sourceParentId",
    ),
  };
}

function resolveBackgroundScheduler(
  dependencies: DeepenInspirationRouteDependencies,
): CreateInspirationBackgroundScheduler {
  if (dependencies.backgroundScheduler) {
    return dependencies.backgroundScheduler;
  }

  return (task) => {
    // Defer to the next macrotask so the route can resolve before queue I/O starts.
    setTimeout(() => {
      void task();
    }, 0);
  };
}

function resolveDeepenInspirationRouteDependencies<
  TParentRecord extends ParentInspirationRecord = ParentInspirationRecord,
  TCreatedRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
>(
  override?: DeepenInspirationRouteDependencies<TParentRecord, TCreatedRecord>,
): DeepenInspirationRouteDependencies<TParentRecord, TCreatedRecord> {
  if (override) {
    return override;
  }

  if (defaultDeepenInspirationRouteDependencies) {
    return defaultDeepenInspirationRouteDependencies as DeepenInspirationRouteDependencies<
      TParentRecord,
      TCreatedRecord
    >;
  }

  throw new Error(DEEPEN_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isDeepenInspirationBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === DEEPEN_INSPIRATION_ID_REQUIRED_ERROR ||
      error.message === DEEPEN_INSPIRATION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(
        DEEPEN_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR,
      ) ||
      error.message === DEEPEN_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR)
  );
}

export function configureDeepenInspirationRouteDependencies(
  dependencies: DeepenInspirationRouteDependencies | null,
): void {
  defaultDeepenInspirationRouteDependencies = dependencies;
}

export function buildReadParentInspirationPersistenceArgs(
  userId: string,
  inspirationId: string,
): ReadParentInspirationPersistenceArgs {
  return {
    where: {
      id: readRequiredTrimmedString(inspirationId, "inspirationId"),
      userId: readRequiredTrimmedString(userId, "User id"),
      deletedAt: null,
    },
    select: {
      id: true,
      clusterId: true,
      sourceParentId: true,
    },
  };
}

export function buildDeepenInspirationPersistenceArgs(
  userId: string,
  parentInspiration: ParentInspirationRecord,
  input: DeepenInspirationRequestBody,
): CreateInspirationPersistenceArgs {
  const parentId = readRequiredTrimmedString(
    parentInspiration.id,
    "Parent inspiration id",
  );
  const sourceParentId = readSourceParentId(
    parentInspiration.sourceParentId,
    parentId,
  );
  const clusterId = readParentClusterId(parentInspiration.clusterId);

  return buildCreateInspirationPersistenceArgs(userId, {
    rawContent: input.rawContent,
    sourceType: DEEPEN_INSPIRATION_CHILD_SOURCE_TYPE,
    parentId,
    sourceParentId,
    ...(clusterId === undefined ? {} : { clusterId }),
  });
}

export async function parseDeepenInspirationRequestBody(
  request: Request,
): Promise<DeepenInspirationRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${DEEPEN_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(DEEPEN_INSPIRATION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripDeepenOwnedFields(payload);

  return {
    rawContent: readRequiredRawContent(sanitizedPayload.rawContent),
  };
}

async function readParentInspiration<
  TParentRecord extends ParentInspirationRecord = ParentInspirationRecord,
>(
  client: DeepenInspirationPersistenceClient<TParentRecord>,
  userId: string,
  inspirationId: string,
): Promise<TParentRecord> {
  const parentInspiration = await client.inspiration.findFirst(
    buildReadParentInspirationPersistenceArgs(userId, inspirationId),
  );

  if (parentInspiration === null) {
    throw new InspirationRouteNotFoundError();
  }

  return parentInspiration;
}

export async function handleDeepenInspirationRouteRequest<
  TParentRecord extends ParentInspirationRecord = ParentInspirationRecord,
  TCreatedRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
>(
  request: Request,
  options: HandleDeepenInspirationRouteRequestOptions<
    TParentRecord,
    TCreatedRecord
  >,
): Promise<Response> {
  let dependencies: DeepenInspirationRouteDependencies<
    TParentRecord,
    TCreatedRecord
  >;

  try {
    dependencies = resolveDeepenInspirationRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: DEEPEN_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      DEEPEN_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
      },
      DEEPEN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const parentInspirationId = readParentInspirationId(options.params);
    const input = await parseDeepenInspirationRequestBody(request);
    const parentInspiration = await readParentInspiration(
      dependencies.persistence,
      authenticatedUserId,
      parentInspirationId,
    );
    const createArgs = buildDeepenInspirationPersistenceArgs(
      authenticatedUserId,
      parentInspiration,
      input,
    );
    const createdInspiration =
      await dependencies.persistence.inspiration.create(createArgs);
    const scheduler = resolveBackgroundScheduler(dependencies);
    const logger = dependencies.logger ?? console;
    const sourceParentId = readRequiredTrimmedString(
      createArgs.data.sourceParentId,
      "Created inspiration sourceParentId",
    );

    scheduler(async () => {
      try {
        await enqueueInspirationEnrichmentJob({
          inspirationId: createdInspiration.id,
          userId: authenticatedUserId,
        }, {
          pipelinePersistence: dependencies.enrichmentPipeline,
          queuePublisher: dependencies.queuePublisher,
        });
      } catch (error) {
        logger.error(error);
      }

      try {
        await dependencies.queuePublisher.enqueue(
          buildSourceParentEmbeddingRefreshJobPayload(sourceParentId),
        );
      } catch (error) {
        logger.error(error);
      }
    });

    return createJsonResponse<DeepenInspirationResponseBody>(
      {
        childId: createdInspiration.id,
        id: createdInspiration.id,
        processingState: buildCreateInspirationProcessingState(),
        rawContent: createdInspiration.rawContent,
        sourceType: createdInspiration.sourceType,
        sourceParentId,
      },
      DEEPEN_INSPIRATION_ROUTE_CREATED_STATUS,
    );
  } catch (error) {
    if (error instanceof InspirationRouteNotFoundError) {
      return createInspirationRouteNotFoundResponse();
    }

    if (isDeepenInspirationBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        DEEPEN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: DEEPEN_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      DEEPEN_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
