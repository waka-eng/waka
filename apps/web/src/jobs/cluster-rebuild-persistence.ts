export interface ClusterRebuildTrackedInspirationRecord {
  clusterId?: string | null;
  id: string;
}

export interface ClusterRebuildTrackedClusterRecord {
  id: string;
}

export interface FindClusterRebuildInspirationsArgs {
  select: {
    clusterId: true;
    id: true;
  };
  where: {
    deletedAt: null;
    userId: string;
  };
}

export interface FindClusterRebuildClustersArgs {
  select: {
    id: true;
  };
  where: {
    userId: string;
  };
}

export interface DeleteEmptyClustersArgs {
  where: {
    id: {
      in: string[];
    };
    userId: string;
  };
}

export interface ClusterRebuildPersistenceClient<
  TInspirationRecord extends ClusterRebuildTrackedInspirationRecord = ClusterRebuildTrackedInspirationRecord,
  TClusterRecord extends ClusterRebuildTrackedClusterRecord = ClusterRebuildTrackedClusterRecord,
> {
  inspiration: {
    findMany(
      args: FindClusterRebuildInspirationsArgs,
    ): Promise<TInspirationRecord[]>;
  };
  cluster: {
    deleteMany(args: DeleteEmptyClustersArgs): Promise<unknown>;
    findMany(args: FindClusterRebuildClustersArgs): Promise<TClusterRecord[]>;
  };
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readOptionalClusterId(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
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

export function buildFindClusterRebuildInspirationsArgs(
  userId: string,
): FindClusterRebuildInspirationsArgs {
  return {
    select: {
      clusterId: true,
      id: true,
    },
    where: {
      deletedAt: null,
      userId: readRequiredNonEmptyString(userId, "Cluster rebuild user id"),
    },
  };
}

export function buildFindClusterRebuildClustersArgs(
  userId: string,
): FindClusterRebuildClustersArgs {
  return {
    select: {
      id: true,
    },
    where: {
      userId: readRequiredNonEmptyString(userId, "Cluster rebuild user id"),
    },
  };
}

export function resolveEmptyClusterIds(
  clusters: readonly ClusterRebuildTrackedClusterRecord[],
  inspirations: readonly ClusterRebuildTrackedInspirationRecord[],
): string[] {
  const activeClusterIds = new Set<string>();

  for (const inspiration of inspirations) {
    const clusterId = readOptionalClusterId(inspiration.clusterId);

    if (clusterId !== undefined) {
      activeClusterIds.add(clusterId);
    }
  }

  return clusters.flatMap((cluster) => {
    const clusterId = readRequiredNonEmptyString(cluster.id, "Cluster id");

    return activeClusterIds.has(clusterId) ? [] : [clusterId];
  });
}

export function buildDeleteEmptyClustersArgs(
  userId: string,
  clusterIds: readonly string[],
): DeleteEmptyClustersArgs {
  const normalizedClusterIds = normalizeClusterIds(clusterIds);

  if (normalizedClusterIds.length === 0) {
    throw new RangeError(
      "Empty cluster deletion requires at least one cluster id.",
    );
  }

  return {
    where: {
      id: {
        in: normalizedClusterIds,
      },
      userId: readRequiredNonEmptyString(userId, "Cluster rebuild user id"),
    },
  };
}
