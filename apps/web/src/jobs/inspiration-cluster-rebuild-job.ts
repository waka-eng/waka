import type { ClusterRebuildSqsJobPayload } from "../../../../packages/shared/types.ts";

export const DEFAULT_CLUSTER_REBUILD_TRIGGER_EVERY = 5;
export const DEFAULT_CLUSTER_REBUILD_DBSCAN_EPSILON = 0.25;
export const DEFAULT_CLUSTER_REBUILD_DBSCAN_MIN_SAMPLES = 3;

export interface CountClusterableInspirationsArgs {
  where: {
    deletedAt: null;
    embedding: {
      not: null;
    };
    userId: string;
  };
}

export interface ClusterRebuildTriggerPersistenceClient {
  inspiration: {
    count(args: CountClusterableInspirationsArgs): Promise<number>;
  };
}

export interface ClusterRebuildJobPublisher {
  enqueue(payload: ClusterRebuildSqsJobPayload): Promise<void>;
}

export interface BuildClusterRebuildJobPayloadInput {
  triggerInspirationId?: string;
  userId: string;
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return value;
}

function readOptionalNonEmptyString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function buildCountClusterableInspirationsArgs(
  userId: string,
): CountClusterableInspirationsArgs {
  return {
    where: {
      deletedAt: null,
      embedding: {
        not: null,
      },
      userId: readRequiredNonEmptyString(userId, "Cluster rebuild user id"),
    },
  };
}

export async function countClusterableInspirations(
  client: ClusterRebuildTriggerPersistenceClient,
  userId: string,
): Promise<number> {
  return client.inspiration.count(buildCountClusterableInspirationsArgs(userId));
}

export function shouldTriggerClusterRebuild(
  clusterableInspirationCount: number,
  triggerEvery = DEFAULT_CLUSTER_REBUILD_TRIGGER_EVERY,
): boolean {
  return (
    readPositiveInteger(
      clusterableInspirationCount,
      "Clusterable inspiration count",
    ) %
      readPositiveInteger(triggerEvery, "Cluster rebuild trigger cadence") ===
    0
  );
}

export function buildClusterRebuildJobPayload(
  input: BuildClusterRebuildJobPayloadInput,
): ClusterRebuildSqsJobPayload {
  const triggerInspirationId = readOptionalNonEmptyString(
    input.triggerInspirationId,
  );

  return {
    jobType: "cluster_rebuild",
    ...(triggerInspirationId === undefined ? {} : { triggerInspirationId }),
    userId: readRequiredNonEmptyString(
      input.userId,
      "Cluster rebuild user id",
    ),
  };
}
