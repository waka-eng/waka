import {
  SUPPORTED_INSPIRATION_SOURCE_TYPES,
  type InspirationSourceType,
} from "./create-route.ts";
import {
  normalizeInspirationEnrichmentFields,
  type InspirationEnrichmentFields,
} from "./enrichment-field-metadata.ts";

export const LIST_INSPIRATIONS_ROUTE_OK_STATUS = 200;
export const LIST_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS = 400;
export const LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS = 401;
export const LIST_INSPIRATIONS_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const LIST_INSPIRATIONS_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const LIST_INSPIRATIONS_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "List inspirations route dependencies have not been configured.";
export const LIST_INSPIRATIONS_ROUTE_LIMIT_INVALID_ERROR =
  "limit must be a positive integer.";

export const DEFAULT_LIST_INSPIRATIONS_LIMIT = 20;
export const MAX_LIST_INSPIRATIONS_LIMIT = 100;

export interface ListedInspiration {
  id: string;
  rawContent: string;
  sourceType: InspirationSourceType;
  sourceParentId?: string;
  expansions?: ListedInspirationExpansion[];
  enrichmentFields?: InspirationEnrichmentFields;
  summary?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListedInspirationExpansion {
  id: string;
  rawContent: string;
  sourceType: InspirationSourceType;
  sourceParentId?: string;
  enrichmentFields?: InspirationEnrichmentFields;
  summary?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListInspirationsResponseBody {
  inspirations: ListedInspiration[];
}

export interface ListedInspirationRecord {
  id: unknown;
  rawContent: unknown;
  sourceType: unknown;
  sourceParentId?: unknown;
  expansions?: unknown;
  enrichmentFields?: unknown;
  summary?: unknown;
  title?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ListInspirationsPersistenceArgs {
  orderBy: Array<{
    createdAt: "asc" | "desc";
  }>;
  select: {
    expansions: {
      orderBy: Array<{
        createdAt: "asc" | "desc";
      }>;
      select: {
        createdAt: true;
        enrichmentFields: true;
        id: true;
        rawContent: true;
        sourceType: true;
        sourceParentId: true;
        summary: true;
        title: true;
        updatedAt: true;
      };
      where: {
        deletedAt: null;
        userId: string;
      };
    };
    id: true;
    rawContent: true;
    sourceType: true;
    sourceParentId: true;
    enrichmentFields: true;
    summary: true;
    title: true;
    createdAt: true;
    updatedAt: true;
  };
  take: number;
  where: {
    deletedAt: null;
    userId: string;
  };
}

export interface ListInspirationsPersistenceClient<
  TRecord extends ListedInspirationRecord = ListedInspirationRecord,
> {
  inspiration: {
    findMany(args: ListInspirationsPersistenceArgs): Promise<TRecord[]>;
  };
}

export interface ListInspirationsRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface ListInspirationsRouteDependencies<
  TRecord extends ListedInspirationRecord = ListedInspirationRecord,
> {
  auth: ListInspirationsRouteAuthResolver;
  persistence: ListInspirationsPersistenceClient<TRecord>;
}

export interface HandleListInspirationsRouteRequestOptions<
  TRecord extends ListedInspirationRecord = ListedInspirationRecord,
> {
  dependencies?: ListInspirationsRouteDependencies<TRecord>;
}

let defaultListInspirationsRouteDependencies:
  | ListInspirationsRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function readRequiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readLimitFromRequest(request: Request): number {
  const rawLimit = new URL(request.url).searchParams.get("limit");

  if (rawLimit === null || rawLimit.trim().length === 0) {
    return DEFAULT_LIST_INSPIRATIONS_LIMIT;
  }

  const normalizedLimit = rawLimit.trim();
  const parsedLimit = Number(normalizedLimit);

  if (
    !/^\d+$/u.test(normalizedLimit) ||
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1
  ) {
    throw new TypeError(LIST_INSPIRATIONS_ROUTE_LIMIT_INVALID_ERROR);
  }

  return Math.min(parsedLimit, MAX_LIST_INSPIRATIONS_LIMIT);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected an optional string inspiration list field.");
  }

  return value;
}

function normalizeSourceType(
  value: unknown,
  rowIndex: number,
): InspirationSourceType {
  if (
    typeof value === "string" &&
    SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(value as InspirationSourceType)
  ) {
    return value as InspirationSourceType;
  }

  throw new TypeError(
    `Inspiration list row ${rowIndex} returned an invalid sourceType value.`,
  );
}

function normalizeTimestamp(
  value: unknown,
  rowIndex: number,
  fieldName: "createdAt" | "updatedAt",
): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Inspiration list row ${rowIndex} returned an invalid ${fieldName} value.`,
    );
  }

  return date.toISOString();
}

function normalizeListedInspirationExpansion(
  value: unknown,
  rowIndex: number,
  expansionIndex: number,
): ListedInspirationExpansion {
  const labelPrefix = `Inspiration list row ${rowIndex} expansion ${expansionIndex}`;

  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${labelPrefix} must be an object.`);
  }

  const record = value as ListedInspirationRecord;
  const sourceParentId = normalizeOptionalString(record.sourceParentId);
  const normalizedId = readRequiredNonEmptyString(record.id, `${labelPrefix} id`);
  const enrichmentFields = normalizeInspirationEnrichmentFields(
    record.enrichmentFields,
    `${labelPrefix} enrichmentFields`,
  );
  const summary = normalizeOptionalString(record.summary);
  const title = normalizeOptionalString(record.title);

  return {
    id: normalizedId,
    rawContent: readRequiredNonEmptyString(
      record.rawContent,
      `${labelPrefix} rawContent`,
    ),
    sourceType: normalizeSourceType(record.sourceType, expansionIndex),
    ...(sourceParentId === undefined ? {} : { sourceParentId }),
    ...(enrichmentFields === undefined ? {} : { enrichmentFields }),
    ...(summary === undefined ? {} : { summary }),
    ...(title === undefined ? {} : { title }),
    createdAt: normalizeTimestamp(record.createdAt, expansionIndex, "createdAt"),
    updatedAt: normalizeTimestamp(record.updatedAt, expansionIndex, "updatedAt"),
  };
}

function normalizeListedInspirationExpansions(
  value: unknown,
  rowIndex: number,
): ListedInspirationExpansion[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(
      `Inspiration list row ${rowIndex} expansions must be an array.`,
    );
  }

  return value.map((expansion, expansionIndex) =>
    normalizeListedInspirationExpansion(expansion, rowIndex, expansionIndex),
  );
}

function buildListInspirationsExpansionsSelection(
  userId: string,
): ListInspirationsPersistenceArgs["select"]["expansions"] {
  return {
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      rawContent: true,
      sourceType: true,
      sourceParentId: true,
      enrichmentFields: true,
      summary: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  };
}

function resolveListInspirationsRouteDependencies<
  TRecord extends ListedInspirationRecord = ListedInspirationRecord,
>(
  override?: ListInspirationsRouteDependencies<TRecord>,
): ListInspirationsRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultListInspirationsRouteDependencies) {
    return defaultListInspirationsRouteDependencies as ListInspirationsRouteDependencies<TRecord>;
  }

  throw new Error(LIST_INSPIRATIONS_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isListInspirationsBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === LIST_INSPIRATIONS_ROUTE_LIMIT_INVALID_ERROR
  );
}

export function configureListInspirationsRouteDependencies(
  dependencies: ListInspirationsRouteDependencies | null,
): void {
  defaultListInspirationsRouteDependencies = dependencies;
}

export function buildListInspirationsPersistenceArgs(
  userId: string,
  limit: number = DEFAULT_LIST_INSPIRATIONS_LIMIT,
): ListInspirationsPersistenceArgs {
  const normalizedUserId = readRequiredNonEmptyString(userId, "User id");

  return {
    where: {
      userId: normalizedUserId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    select: {
      expansions: buildListInspirationsExpansionsSelection(normalizedUserId),
      id: true,
      rawContent: true,
      sourceType: true,
      sourceParentId: true,
      enrichmentFields: true,
      summary: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  };
}

export async function listInspirations<
  TRecord extends ListedInspirationRecord = ListedInspirationRecord,
>(
  client: ListInspirationsPersistenceClient<TRecord>,
  userId: string,
  limit: number = DEFAULT_LIST_INSPIRATIONS_LIMIT,
): Promise<ListedInspiration[]> {
  const rows = await client.inspiration.findMany(
    buildListInspirationsPersistenceArgs(userId, limit),
  );

  return rows.map((row, index) => {
    const sourceParentId = normalizeOptionalString(row.sourceParentId);
    const expansions = normalizeListedInspirationExpansions(
      row.expansions,
      index,
    );

    return {
      id: readRequiredNonEmptyString(row.id, `Inspiration list row ${index} id`),
      rawContent: readRequiredNonEmptyString(
        row.rawContent,
        `Inspiration list row ${index} rawContent`,
      ),
      sourceType: normalizeSourceType(row.sourceType, index),
      ...(sourceParentId === undefined ? {} : { sourceParentId }),
      ...(expansions === undefined || expansions.length === 0 ? {} : { expansions }),
      enrichmentFields: normalizeInspirationEnrichmentFields(
        row.enrichmentFields,
        `Inspiration list row ${index} enrichmentFields`,
      ),
      summary: normalizeOptionalString(row.summary),
      title: normalizeOptionalString(row.title),
      createdAt: normalizeTimestamp(row.createdAt, index, "createdAt"),
      updatedAt: normalizeTimestamp(row.updatedAt, index, "updatedAt"),
    };
  });
}

export async function handleListInspirationsRouteRequest<
  TRecord extends ListedInspirationRecord = ListedInspirationRecord,
>(
  request: Request,
  options: HandleListInspirationsRouteRequestOptions<TRecord> = {},
): Promise<Response> {
  let dependencies: ListInspirationsRouteDependencies<TRecord>;

  try {
    dependencies = resolveListInspirationsRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: LIST_INSPIRATIONS_ROUTE_INTERNAL_ERROR,
      },
      LIST_INSPIRATIONS_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR,
      },
      LIST_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const inspirations = await listInspirations(
      dependencies.persistence,
      authenticatedUserId,
      readLimitFromRequest(request),
    );

    return createJsonResponse<ListInspirationsResponseBody>(
      {
        inspirations,
      },
      LIST_INSPIRATIONS_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isListInspirationsBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        LIST_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: LIST_INSPIRATIONS_ROUTE_INTERNAL_ERROR,
      },
      LIST_INSPIRATIONS_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
