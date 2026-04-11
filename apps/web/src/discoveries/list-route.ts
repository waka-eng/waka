import {
  SUPPORTED_INSPIRATION_SOURCE_TYPES,
  type InspirationSourceType,
} from "../inspirations/create-route.ts";
import { CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE } from "./cluster-reassignment-persistence.ts";

export const LIST_DISCOVERIES_ROUTE_OK_STATUS = 200;
export const LIST_DISCOVERIES_ROUTE_BAD_REQUEST_STATUS = 400;
export const LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_STATUS = 401;
export const LIST_DISCOVERIES_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const LIST_DISCOVERIES_ROUTE_INTERNAL_ERROR = "Internal Server Error";
export const LIST_DISCOVERIES_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "List discoveries route dependencies have not been configured.";
export const LIST_DISCOVERIES_ROUTE_LIMIT_INVALID_ERROR =
  "limit must be a positive integer.";

export const DEFAULT_LIST_DISCOVERIES_LIMIT = 20;
export const MAX_LIST_DISCOVERIES_LIMIT = 100;

export interface ListedDiscoveryCluster {
  description?: string;
  id: string;
  label?: string;
}

export interface ListedDiscoveryInspiration {
  id: string;
  rawContent: string;
  sourceType: InspirationSourceType;
  summary?: string;
  title?: string;
}

export interface ListedDiscovery {
  createdAt: string;
  eventType: typeof CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE;
  id: string;
  inspiration: ListedDiscoveryInspiration;
  newCluster: ListedDiscoveryCluster;
  previousCluster: ListedDiscoveryCluster;
}

export interface ListDiscoveriesResponseBody {
  discoveries: ListedDiscovery[];
}

export interface ListedDiscoveryEventRecord {
  createdAt: unknown;
  eventType: unknown;
  id: unknown;
  inspiration: unknown;
  newClusterId: unknown;
  previousClusterId: unknown;
}

export interface ListedDiscoveryClusterRecord {
  description?: unknown;
  id: unknown;
  label?: unknown;
}

export interface ListDiscoveriesEventsPersistenceArgs {
  orderBy: Array<{
    createdAt: "asc" | "desc";
  }>;
  select: {
    createdAt: true;
    eventType: true;
    id: true;
    inspiration: {
      select: {
        id: true;
        rawContent: true;
        sourceType: true;
        summary: true;
        title: true;
      };
    };
    newClusterId: true;
    previousClusterId: true;
  };
  take: number;
  where: {
    eventType: typeof CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE;
    userId: string;
  };
}

export interface ListDiscoveriesClustersPersistenceArgs {
  select: {
    description: true;
    id: true;
    label: true;
  };
  where: {
    id: {
      in: string[];
    };
    userId: string;
  };
}

export interface ListDiscoveriesPersistenceClient<
  TEventRecord extends ListedDiscoveryEventRecord = ListedDiscoveryEventRecord,
  TClusterRecord extends ListedDiscoveryClusterRecord = ListedDiscoveryClusterRecord,
> {
  cluster: {
    findMany(args: ListDiscoveriesClustersPersistenceArgs): Promise<TClusterRecord[]>;
  };
  discoveryEvent: {
    findMany(args: ListDiscoveriesEventsPersistenceArgs): Promise<TEventRecord[]>;
  };
}

export interface ListDiscoveriesRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface ListDiscoveriesRouteDependencies<
  TEventRecord extends ListedDiscoveryEventRecord = ListedDiscoveryEventRecord,
  TClusterRecord extends ListedDiscoveryClusterRecord = ListedDiscoveryClusterRecord,
> {
  auth: ListDiscoveriesRouteAuthResolver;
  persistence: ListDiscoveriesPersistenceClient<TEventRecord, TClusterRecord>;
}

export interface HandleListDiscoveriesRouteRequestOptions<
  TEventRecord extends ListedDiscoveryEventRecord = ListedDiscoveryEventRecord,
  TClusterRecord extends ListedDiscoveryClusterRecord = ListedDiscoveryClusterRecord,
> {
  dependencies?: ListDiscoveriesRouteDependencies<TEventRecord, TClusterRecord>;
}

let defaultListDiscoveriesRouteDependencies:
  | ListDiscoveriesRouteDependencies
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

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected an optional string discoveries field.");
  }

  return value;
}

function readLimitFromRequest(request: Request): number {
  const rawLimit = new URL(request.url).searchParams.get("limit");

  if (rawLimit === null || rawLimit.trim().length === 0) {
    return DEFAULT_LIST_DISCOVERIES_LIMIT;
  }

  const normalizedLimit = rawLimit.trim();
  const parsedLimit = Number(normalizedLimit);

  if (
    !/^\d+$/u.test(normalizedLimit) ||
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1
  ) {
    throw new TypeError(LIST_DISCOVERIES_ROUTE_LIMIT_INVALID_ERROR);
  }

  return Math.min(parsedLimit, MAX_LIST_DISCOVERIES_LIMIT);
}

function normalizeTimestamp(value: unknown, rowIndex: number): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Discoveries row ${rowIndex} returned an invalid createdAt value.`,
    );
  }

  return date.toISOString();
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
    `Discoveries row ${rowIndex} returned an invalid sourceType value.`,
  );
}

function normalizeEventType(
  value: unknown,
  rowIndex: number,
): typeof CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE {
  if (value === CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE) {
    return value;
  }

  throw new TypeError(
    `Discoveries row ${rowIndex} returned an unsupported eventType value.`,
  );
}

function normalizeListedDiscoveryInspiration(
  value: unknown,
  rowIndex: number,
): ListedDiscoveryInspiration {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`Discoveries row ${rowIndex} inspiration must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const summary = readOptionalString(record.summary);
  const title = readOptionalString(record.title);

  return {
    id: readRequiredNonEmptyString(
      record.id,
      `Discoveries row ${rowIndex} inspiration id`,
    ),
    rawContent: readRequiredNonEmptyString(
      record.rawContent,
      `Discoveries row ${rowIndex} inspiration rawContent`,
    ),
    sourceType: normalizeSourceType(record.sourceType, rowIndex),
    ...(summary === undefined ? {} : { summary }),
    ...(title === undefined ? {} : { title }),
  };
}

function normalizeClusterIds(clusterIds: readonly string[]): string[] {
  const normalizedClusterIds: string[] = [];
  const seenClusterIds = new Set<string>();

  for (const clusterId of clusterIds) {
    const normalizedClusterId = readRequiredNonEmptyString(
      clusterId,
      "Cluster id",
    );

    if (seenClusterIds.has(normalizedClusterId)) {
      continue;
    }

    seenClusterIds.add(normalizedClusterId);
    normalizedClusterIds.push(normalizedClusterId);
  }

  return normalizedClusterIds;
}

function collectDiscoveryClusterIds(
  events: readonly ListedDiscoveryEventRecord[],
): string[] {
  return normalizeClusterIds(
    events.flatMap((event) => [
      readRequiredNonEmptyString(event.previousClusterId, "Previous cluster id"),
      readRequiredNonEmptyString(event.newClusterId, "New cluster id"),
    ]),
  );
}

function createListedDiscoveryCluster(
  clusterId: string,
  clusterRecord?: ListedDiscoveryClusterRecord,
): ListedDiscoveryCluster {
  const label = readOptionalString(clusterRecord?.label);
  const description = readOptionalString(clusterRecord?.description);

  return {
    id: clusterId,
    ...(description === undefined ? {} : { description }),
    ...(label === undefined ? {} : { label }),
  };
}

function resolveListDiscoveriesRouteDependencies<
  TEventRecord extends ListedDiscoveryEventRecord = ListedDiscoveryEventRecord,
  TClusterRecord extends ListedDiscoveryClusterRecord = ListedDiscoveryClusterRecord,
>(
  override?: ListDiscoveriesRouteDependencies<TEventRecord, TClusterRecord>,
): ListDiscoveriesRouteDependencies<TEventRecord, TClusterRecord> {
  if (override) {
    return override;
  }

  if (defaultListDiscoveriesRouteDependencies) {
    return defaultListDiscoveriesRouteDependencies as ListDiscoveriesRouteDependencies<
      TEventRecord,
      TClusterRecord
    >;
  }

  throw new Error(LIST_DISCOVERIES_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isListDiscoveriesBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === LIST_DISCOVERIES_ROUTE_LIMIT_INVALID_ERROR
  );
}

export function configureListDiscoveriesRouteDependencies(
  dependencies: ListDiscoveriesRouteDependencies | null,
): void {
  defaultListDiscoveriesRouteDependencies = dependencies;
}

export function buildListDiscoveriesEventPersistenceArgs(
  userId: string,
  limit: number = DEFAULT_LIST_DISCOVERIES_LIMIT,
): ListDiscoveriesEventsPersistenceArgs {
  return {
    where: {
      eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
      userId: readRequiredNonEmptyString(userId, "User id"),
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    select: {
      createdAt: true,
      eventType: true,
      id: true,
      inspiration: {
        select: {
          id: true,
          rawContent: true,
          sourceType: true,
          summary: true,
          title: true,
        },
      },
      newClusterId: true,
      previousClusterId: true,
    },
  };
}

export function buildListDiscoveriesClusterPersistenceArgs(
  userId: string,
  clusterIds: readonly string[],
): ListDiscoveriesClustersPersistenceArgs {
  const normalizedClusterIds = normalizeClusterIds(clusterIds);

  if (normalizedClusterIds.length === 0) {
    throw new RangeError("Discoveries cluster lookup requires at least one cluster id.");
  }

  return {
    where: {
      id: {
        in: normalizedClusterIds,
      },
      userId: readRequiredNonEmptyString(userId, "User id"),
    },
    select: {
      description: true,
      id: true,
      label: true,
    },
  };
}

export async function listDiscoveries<
  TEventRecord extends ListedDiscoveryEventRecord = ListedDiscoveryEventRecord,
  TClusterRecord extends ListedDiscoveryClusterRecord = ListedDiscoveryClusterRecord,
>(
  client: ListDiscoveriesPersistenceClient<TEventRecord, TClusterRecord>,
  userId: string,
  limit: number = DEFAULT_LIST_DISCOVERIES_LIMIT,
): Promise<ListedDiscovery[]> {
  const events = await client.discoveryEvent.findMany(
    buildListDiscoveriesEventPersistenceArgs(userId, limit),
  );

  if (events.length === 0) {
    return [];
  }

  const clusterIds = collectDiscoveryClusterIds(events);
  const clusters =
    clusterIds.length === 0
      ? []
      : await client.cluster.findMany(
          buildListDiscoveriesClusterPersistenceArgs(userId, clusterIds),
        );
  const clustersById = new Map<string, TClusterRecord>();

  for (const cluster of clusters) {
    const clusterId = readRequiredNonEmptyString(cluster.id, "Cluster id");
    clustersById.set(clusterId, cluster);
  }

  return events.map((event, rowIndex) => {
    const previousClusterId = readRequiredNonEmptyString(
      event.previousClusterId,
      `Discoveries row ${rowIndex} previousClusterId`,
    );
    const newClusterId = readRequiredNonEmptyString(
      event.newClusterId,
      `Discoveries row ${rowIndex} newClusterId`,
    );

    return {
      createdAt: normalizeTimestamp(event.createdAt, rowIndex),
      eventType: normalizeEventType(event.eventType, rowIndex),
      id: readRequiredNonEmptyString(event.id, `Discoveries row ${rowIndex} id`),
      inspiration: normalizeListedDiscoveryInspiration(
        event.inspiration,
        rowIndex,
      ),
      newCluster: createListedDiscoveryCluster(
        newClusterId,
        clustersById.get(newClusterId),
      ),
      previousCluster: createListedDiscoveryCluster(
        previousClusterId,
        clustersById.get(previousClusterId),
      ),
    };
  });
}

export async function handleListDiscoveriesRouteRequest<
  TEventRecord extends ListedDiscoveryEventRecord = ListedDiscoveryEventRecord,
  TClusterRecord extends ListedDiscoveryClusterRecord = ListedDiscoveryClusterRecord,
>(
  request: Request,
  options: HandleListDiscoveriesRouteRequestOptions<
    TEventRecord,
    TClusterRecord
  > = {},
): Promise<Response> {
  let dependencies: ListDiscoveriesRouteDependencies<TEventRecord, TClusterRecord>;

  try {
    dependencies = resolveListDiscoveriesRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: LIST_DISCOVERIES_ROUTE_INTERNAL_ERROR,
      },
      LIST_DISCOVERIES_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_ERROR,
      },
      LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const discoveries = await listDiscoveries(
      dependencies.persistence,
      authenticatedUserId,
      readLimitFromRequest(request),
    );

    return createJsonResponse<ListDiscoveriesResponseBody>(
      {
        discoveries,
      },
      LIST_DISCOVERIES_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isListDiscoveriesBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        LIST_DISCOVERIES_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: LIST_DISCOVERIES_ROUTE_INTERNAL_ERROR,
      },
      LIST_DISCOVERIES_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
