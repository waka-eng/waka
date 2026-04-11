export const CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE =
  "CLUSTER_REASSIGNED";

export interface DiscoveryEventInspirationClusterRecord {
  clusterId: string | null;
  id: string;
}

export interface FindDiscoveryEventInspirationClusterArgs {
  select: {
    clusterId: true;
    id: true;
  };
  where: {
    deletedAt: null;
    id: string;
    userId: string;
  };
}

export interface CreateClusterReassignmentDiscoveryEventInput {
  createdAt?: Date;
  inspirationId: string;
  newClusterId: string;
  previousClusterId: string;
  userId: string;
}

export interface CreateClusterReassignmentDiscoveryEventArgs {
  data: {
    createdAt?: Date;
    eventType: typeof CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE;
    inspirationId: string;
    newClusterId: string;
    previousClusterId: string;
    userId: string;
  };
}

export interface ClusterReassignmentDiscoveryEventRecord {
  id: string;
}

export interface ClusterReassignmentDiscoveryEventPersistenceClient<
  TInspirationRecord extends DiscoveryEventInspirationClusterRecord = DiscoveryEventInspirationClusterRecord,
  TDiscoveryEventRecord extends ClusterReassignmentDiscoveryEventRecord = ClusterReassignmentDiscoveryEventRecord,
> {
  discoveryEvent: {
    create(
      args: CreateClusterReassignmentDiscoveryEventArgs,
    ): Promise<TDiscoveryEventRecord>;
  };
  inspiration: {
    findFirst(
      args: FindDiscoveryEventInspirationClusterArgs,
    ): Promise<TInspirationRecord | null>;
  };
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readOptionalNonEmptyString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function buildFindDiscoveryEventInspirationClusterArgs(
  userId: string,
  inspirationId: string,
): FindDiscoveryEventInspirationClusterArgs {
  return {
    select: {
      clusterId: true,
      id: true,
    },
    where: {
      deletedAt: null,
      id: readRequiredNonEmptyString(inspirationId, "Inspiration id"),
      userId: readRequiredNonEmptyString(userId, "User id"),
    },
  };
}

export async function findDiscoveryEventInspirationCluster<
  TInspirationRecord extends DiscoveryEventInspirationClusterRecord,
>(
  client: ClusterReassignmentDiscoveryEventPersistenceClient<TInspirationRecord>,
  userId: string,
  inspirationId: string,
): Promise<TInspirationRecord | null> {
  return client.inspiration.findFirst(
    buildFindDiscoveryEventInspirationClusterArgs(userId, inspirationId),
  );
}

export function shouldCreateClusterReassignmentDiscoveryEvent(
  previousClusterId: string | null | undefined,
  newClusterId: string | null | undefined,
): boolean {
  const normalizedPreviousClusterId =
    readOptionalNonEmptyString(previousClusterId);
  const normalizedNewClusterId = readOptionalNonEmptyString(newClusterId);

  return (
    normalizedPreviousClusterId !== undefined &&
    normalizedNewClusterId !== undefined &&
    normalizedPreviousClusterId !== normalizedNewClusterId
  );
}

export function buildCreateClusterReassignmentDiscoveryEventArgs(
  input: CreateClusterReassignmentDiscoveryEventInput,
): CreateClusterReassignmentDiscoveryEventArgs {
  const previousClusterId = readRequiredNonEmptyString(
    input.previousClusterId,
    "Previous cluster id",
  );
  const newClusterId = readRequiredNonEmptyString(
    input.newClusterId,
    "New cluster id",
  );

  if (previousClusterId === newClusterId) {
    throw new RangeError(
      "Cluster reassignment discovery events require different previousClusterId and newClusterId values.",
    );
  }

  return {
    data: {
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
      inspirationId: readRequiredNonEmptyString(
        input.inspirationId,
        "Inspiration id",
      ),
      newClusterId,
      previousClusterId,
      userId: readRequiredNonEmptyString(input.userId, "User id"),
    },
  };
}

export async function createClusterReassignmentDiscoveryEvent<
  TInspirationRecord extends DiscoveryEventInspirationClusterRecord,
  TDiscoveryEventRecord extends ClusterReassignmentDiscoveryEventRecord,
>(
  client: ClusterReassignmentDiscoveryEventPersistenceClient<
    TInspirationRecord,
    TDiscoveryEventRecord
  >,
  input: CreateClusterReassignmentDiscoveryEventInput,
): Promise<TDiscoveryEventRecord> {
  return client.discoveryEvent.create(
    buildCreateClusterReassignmentDiscoveryEventArgs(input),
  );
}
