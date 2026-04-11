import type { AiEnrichmentSqsJobPayload } from "../../../../packages/shared/types.ts";
import {
  ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR,
  buildFindSelectiveInspirationEnrichmentArgs,
  buildMarkSelectedInspirationEnrichmentEnqueuedArgs,
  type SelectiveInspirationEnrichmentRerunPersistenceClient,
} from "./enrichment-pipeline.ts";
import {
  isInspirationEnrichmentFieldName,
  type InspirationEnrichmentFieldName,
} from "./enrichment-field-metadata.ts";
import {
  createInspirationRouteNotFoundResponse,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
} from "./not-found-response.ts";

export const RERUN_INSPIRATION_ROUTE_ACCEPTED_STATUS = 202;
export const RERUN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS = 400;
export const RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const RERUN_INSPIRATION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const RERUN_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const RERUN_INSPIRATION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const RERUN_INSPIRATION_ROUTE_INTERNAL_ERROR = "Internal Server Error";
export const RERUN_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Rerun inspiration route dependencies have not been configured.";
export const RERUN_INSPIRATION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const RERUN_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR =
  "fieldNames must be an array of valid AI enrichment field names when provided.";
export const RERUN_INSPIRATION_REQUEST_FIELD_NAMES_EMPTY_ERROR =
  "fieldNames must include at least one AI enrichment field name when provided.";
export const RERUN_INSPIRATION_ID_REQUIRED_ERROR =
  "inspirationId must be a non-empty string.";

export interface RerunInspirationRequestBody {
  fieldNames?: InspirationEnrichmentFieldName[];
}

export interface RerunInspirationResponseBody {
  id: string;
  queuedFieldNames: InspirationEnrichmentFieldName[];
}

export interface RerunInspirationRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface RerunInspirationQueuePublisher {
  enqueue(payload: AiEnrichmentSqsJobPayload): Promise<void>;
}

export type RerunInspirationBackgroundScheduler = (
  task: () => Promise<void>,
) => void;

export interface RerunInspirationRouteDependencies {
  auth: RerunInspirationRouteAuthResolver;
  backgroundScheduler?: RerunInspirationBackgroundScheduler;
  enrichmentPipeline: SelectiveInspirationEnrichmentRerunPersistenceClient;
  logger?: Pick<Console, "error">;
  queuePublisher: RerunInspirationQueuePublisher;
}

export interface RerunInspirationRouteParams {
  inspirationId: string;
}

export interface HandleRerunInspirationRouteRequestOptions {
  dependencies?: RerunInspirationRouteDependencies;
  params: RerunInspirationRouteParams;
}

let defaultRerunInspirationRouteDependencies:
  | RerunInspirationRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripRerunOwnershipFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    ownerId: _ownerId,
    userId: _userId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    ...sanitizedPayload
  } = payload;

  return sanitizedPayload;
}

function readRequiredTrimmedString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readFieldNames(
  payload: Record<string, unknown>,
): InspirationEnrichmentFieldName[] | undefined {
  if (!hasOwn(payload, "fieldNames")) {
    return undefined;
  }

  const value = payload.fieldNames;

  if (!Array.isArray(value)) {
    throw new TypeError(RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR);
  }

  if (value.length === 0) {
    throw new TypeError(RERUN_INSPIRATION_REQUEST_FIELD_NAMES_EMPTY_ERROR);
  }

  const normalizedFieldNames = value.map((entry) => {
    if (typeof entry !== "string") {
      throw new TypeError(RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR);
    }

    const normalizedEntry = entry.trim();

    if (!isInspirationEnrichmentFieldName(normalizedEntry)) {
      throw new TypeError(RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR);
    }

    return normalizedEntry;
  });

  return [...new Set(normalizedFieldNames)];
}

function readInspirationId(params: RerunInspirationRouteParams): string {
  return readRequiredTrimmedString(params.inspirationId, "inspirationId");
}

function resolveBackgroundScheduler(
  dependencies: RerunInspirationRouteDependencies,
): RerunInspirationBackgroundScheduler {
  if (dependencies.backgroundScheduler) {
    return dependencies.backgroundScheduler;
  }

  return (task) => {
    setTimeout(() => {
      void task();
    }, 0);
  };
}

function resolveRerunInspirationRouteDependencies(
  override?: RerunInspirationRouteDependencies,
): RerunInspirationRouteDependencies {
  if (override) {
    return override;
  }

  if (defaultRerunInspirationRouteDependencies) {
    return defaultRerunInspirationRouteDependencies;
  }

  throw new Error(RERUN_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isRerunInspirationBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === RERUN_INSPIRATION_ID_REQUIRED_ERROR ||
      error.message === RERUN_INSPIRATION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(RERUN_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR) ||
      error.message === RERUN_INSPIRATION_REQUEST_FIELD_NAMES_INVALID_ERROR ||
      error.message === RERUN_INSPIRATION_REQUEST_FIELD_NAMES_EMPTY_ERROR ||
      error.message === ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR)
  );
}

export function configureRerunInspirationRouteDependencies(
  dependencies: RerunInspirationRouteDependencies | null,
): void {
  defaultRerunInspirationRouteDependencies = dependencies;
}

export async function parseRerunInspirationRequestBody(
  request: Request,
): Promise<RerunInspirationRequestBody> {
  let payload: unknown = {};

  try {
    const rawBody = await request.text();

    if (rawBody.trim().length > 0) {
      payload = JSON.parse(rawBody);
    }
  } catch (error) {
    throw new TypeError(
      `${RERUN_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(RERUN_INSPIRATION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripRerunOwnershipFields(payload);
  const fieldNames = readFieldNames(sanitizedPayload);

  return fieldNames === undefined ? {} : { fieldNames };
}

export async function handleRerunInspirationRouteRequest(
  request: Request,
  options: HandleRerunInspirationRouteRequestOptions,
): Promise<Response> {
  let dependencies: RerunInspirationRouteDependencies;

  try {
    dependencies = resolveRerunInspirationRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: RERUN_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      RERUN_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
      },
      RERUN_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const inspirationId = readInspirationId(options.params);
    const input = await parseRerunInspirationRequestBody(request);
    const inspiration =
      await dependencies.enrichmentPipeline.inspiration.findFirst(
        buildFindSelectiveInspirationEnrichmentArgs(
          authenticatedUserId,
          inspirationId,
        ),
      );

    if (!inspiration) {
      return createInspirationRouteNotFoundResponse();
    }

    const updateArgs = buildMarkSelectedInspirationEnrichmentEnqueuedArgs(
      authenticatedUserId,
      inspirationId,
      inspiration,
      new Date(),
      input.fieldNames,
    );
    const queuedFieldNames = updateArgs.data.enrichmentResumeState.remainingFieldNames.filter(
      (fieldName) =>
        updateArgs.data.enrichmentFields[fieldName].status === "PENDING",
    );
    const scheduler = resolveBackgroundScheduler(dependencies);
    const logger = dependencies.logger ?? console;

    scheduler(async () => {
      try {
        await dependencies.queuePublisher.enqueue({
          fieldNames: queuedFieldNames,
          jobType: "ai_enrichment",
          inspirationId,
        });
        await dependencies.enrichmentPipeline.inspiration.update(updateArgs);
      } catch (error) {
        logger.error(error);
      }
    });

    return createJsonResponse<RerunInspirationResponseBody>(
      {
        id: inspirationId,
        queuedFieldNames,
      },
      RERUN_INSPIRATION_ROUTE_ACCEPTED_STATUS,
    );
  } catch (error) {
    if (isRerunInspirationBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        RERUN_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: RERUN_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      RERUN_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
