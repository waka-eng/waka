import {
  WORKSPACE_HOME_REFLECTION_STATUSES,
  WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY,
  type WorkspaceHomeClusterAssignment,
  type WorkspaceHomeClusterItemPreview,
  type WorkspaceHomeClusterPreview,
  type WorkspaceHomeReflectionStatus,
  type WorkspaceHomeTextCaptureEnrichmentUpdate,
} from "./workspace-home-screen-model.ts";
import { normalizeWorkspaceHomeCaptureProcessingState } from "./text-capture-create.ts";

export const WORKSPACE_HOME_PENDING_TEXT_CAPTURE_POLL_INTERVAL_MS = 3000;
export const WORKSPACE_HOME_POLLABLE_TEXT_CAPTURE_SOURCE_TYPE = "TEXT_NOTE";
export const WORKSPACE_HOME_TEXT_CAPTURE_ENRICHMENT_POLL_ID_MISSING_ERROR =
  "Capture enrichment response is missing the persisted id.";

type WorkspaceHomePendingTextCapturePollSource =
  | readonly WorkspaceHomeClusterPreview[]
  | readonly string[];

interface WorkspaceHomeTextCaptureEnrichmentResponseBody {
  cluster?: unknown;
  id?: unknown;
  processingState?: unknown;
  reflectionAnswer?: unknown;
  reflectionPrompt?: unknown;
  reflectionStatus?: unknown;
  sourceType?: unknown;
  summary?: unknown;
  tags?: unknown;
  title?: unknown;
}

interface WorkspaceHomePollableTextCapture
  extends WorkspaceHomeClusterItemPreview {
  id: string;
  sourceType: typeof WORKSPACE_HOME_POLLABLE_TEXT_CAPTURE_SOURCE_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCaptureId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(WORKSPACE_HOME_TEXT_CAPTURE_ENRICHMENT_POLL_ID_MISSING_ERROR);
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected an optional string capture enrichment field.");
  }

  return value;
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError("Expected an optional string array capture enrichment field.");
  }

  return [...value];
}

function normalizeWorkspaceHomeReflectionStatus(
  value: unknown,
): WorkspaceHomeReflectionStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(
      "Expected an optional reflection status capture enrichment field.",
    );
  }

  const normalizedStatus = WORKSPACE_HOME_REFLECTION_STATUSES.find(
    (status) => status === value,
  );

  if (normalizedStatus === undefined) {
    throw new TypeError(
      "Expected a valid reflection status capture enrichment field.",
    );
  }

  return normalizedStatus;
}

function normalizeWorkspaceHomeClusterAssignment(
  value: unknown,
): WorkspaceHomeClusterAssignment | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected an optional cluster assignment object.");
  }

  const cluster = value as {
    description?: unknown;
    id?: unknown;
    label?: unknown;
  };

  if (typeof cluster.id !== "string" || cluster.id.trim().length === 0) {
    throw new TypeError("Cluster assignment is missing a valid id.");
  }

  if (typeof cluster.label !== "string" || cluster.label.trim().length === 0) {
    throw new TypeError("Cluster assignment is missing a valid label.");
  }

  return {
    id: cluster.id.trim(),
    name: cluster.label.trim(),
    summary:
      typeof cluster.description === "string" && cluster.description.trim().length > 0
        ? cluster.description.trim()
        : WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY,
  };
}

function isPendingCaptureEnrichment(
  item: WorkspaceHomeClusterItemPreview,
): boolean {
  return (
    item.isTitlePending ||
    item.isSummaryPending ||
    item.isTagsPending ||
    item.reflectionStatus === "PENDING"
  );
}

export function isWorkspaceHomePollableTextCapture(
  item: WorkspaceHomeClusterItemPreview,
): item is WorkspaceHomePollableTextCapture {
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    item.sourceType === WORKSPACE_HOME_POLLABLE_TEXT_CAPTURE_SOURCE_TYPE &&
    item.saveState !== "saving" &&
    item.saveState !== "queued" &&
    item.saveState !== "failed" &&
    isPendingCaptureEnrichment(item)
  );
}

export function getWorkspaceHomePendingTextCaptureIds(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
): string[] {
  const pendingCaptureIds = new Set<string>();

  for (const cluster of clusterPreviews) {
    for (const item of cluster.items ?? []) {
      if (!isWorkspaceHomePollableTextCapture(item)) {
        continue;
      }

      pendingCaptureIds.add(item.id);
    }
  }

  return [...pendingCaptureIds];
}

function isWorkspaceHomePendingTextCaptureIdList(
  value: WorkspaceHomePendingTextCapturePollSource,
): value is readonly string[] {
  return value.every((entry) => typeof entry === "string");
}

function resolveWorkspaceHomePendingTextCaptureIds(
  value: WorkspaceHomePendingTextCapturePollSource,
): string[] {
  if (isWorkspaceHomePendingTextCaptureIdList(value)) {
    return [...new Set(value.filter((entry) => entry.length > 0))];
  }

  return getWorkspaceHomePendingTextCaptureIds(value);
}

export function parseWorkspaceHomeTextCaptureEnrichmentResponse(
  value: unknown,
): WorkspaceHomeTextCaptureEnrichmentUpdate | null {
  if (!isRecord(value)) {
    throw new TypeError("Capture enrichment response body must be a JSON object.");
  }

  const responseBody = value as WorkspaceHomeTextCaptureEnrichmentResponseBody;

  if (responseBody.sourceType !== WORKSPACE_HOME_POLLABLE_TEXT_CAPTURE_SOURCE_TYPE) {
    return null;
  }

  const cluster = normalizeWorkspaceHomeClusterAssignment(responseBody.cluster);
  const reflectionAnswer = normalizeOptionalString(responseBody.reflectionAnswer);
  const reflectionPrompt = normalizeOptionalString(responseBody.reflectionPrompt);
  const reflectionStatus = normalizeWorkspaceHomeReflectionStatus(
    responseBody.reflectionStatus,
  );
  const summary = normalizeOptionalString(responseBody.summary);
  const tags = normalizeOptionalStringArray(responseBody.tags);
  const title = normalizeOptionalString(responseBody.title);

  return {
    ...(cluster === undefined ? {} : { cluster }),
    id: readCaptureId(responseBody.id),
    processingState: normalizeWorkspaceHomeCaptureProcessingState(
      responseBody.processingState,
    ),
    ...(reflectionAnswer === undefined ? {} : { reflectionAnswer }),
    ...(reflectionPrompt === undefined ? {} : { reflectionPrompt }),
    ...(reflectionStatus === undefined ? {} : { reflectionStatus }),
    ...(summary === undefined ? {} : { summary }),
    ...(tags === undefined ? {} : { tags }),
    ...(title === undefined ? {} : { title }),
  };
}

export async function readWorkspaceHomeTextCaptureEnrichment(
  captureId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<WorkspaceHomeTextCaptureEnrichmentUpdate | null> {
  const response = await fetchImplementation(
    `/api/inspirations/${encodeURIComponent(captureId)}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
      method: "GET",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Capture enrichment poll failed for ${captureId} with status ${response.status}`,
    );
  }

  return parseWorkspaceHomeTextCaptureEnrichmentResponse(await response.json());
}

export async function pollWorkspaceHomePendingTextCaptureEnrichment(
  value: WorkspaceHomePendingTextCapturePollSource,
  fetchImplementation: typeof fetch = fetch,
): Promise<WorkspaceHomeTextCaptureEnrichmentUpdate[]> {
  const pendingCaptureIds = resolveWorkspaceHomePendingTextCaptureIds(value);

  if (pendingCaptureIds.length === 0) {
    return [];
  }

  const settledResponses = await Promise.allSettled(
    pendingCaptureIds.map((captureId) =>
      readWorkspaceHomeTextCaptureEnrichment(captureId, fetchImplementation),
    ),
  );

  return settledResponses.flatMap((result) => {
    if (result.status !== "fulfilled" || result.value === null) {
      return [];
    }

    return [result.value];
  });
}
