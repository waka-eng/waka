import type { WorkspaceHomeCaptureProcessingState } from "./workspace-home-screen-model.ts";
import { normalizeUrlDetectedCapture } from "../inspirations/url-detection.ts";
import type { InspirationEnrichmentFieldStatus } from "../inspirations/enrichment-field-metadata.ts";
import { replayOfflineCaptureQueue } from "../offline/offline-capture-replay-worker.ts";
import {
  createOfflineCaptureQueueStore,
  type OfflineCaptureQueuePayload,
  type OfflineCaptureQueueRecord,
  type OfflineCaptureQueueStore,
} from "../offline/offline-capture-queue-store.ts";

export const WORKSPACE_HOME_CAPTURE_CREATE_RESPONSE_ID_MISSING_ERROR =
  "Capture response is missing the persisted id.";
const WORKSPACE_HOME_RETRYABLE_CAPTURE_CREATE_STATUS_CODES = new Set([
  408,
  425,
  429,
]);

const WORKSPACE_HOME_PENDING_PROCESSING_STATE: WorkspaceHomeCaptureProcessingState =
  {
    isTagsPending: true,
    isSummaryPending: true,
    isTitlePending: true,
  };

let workspaceHomeOfflineCaptureQueueStore: OfflineCaptureQueueStore | undefined;

interface WorkspaceHomeTextCaptureCreateResponseBody {
  id?: unknown;
  processingState?: unknown;
}

interface WorkspaceHomeTextCaptureProcessingFieldState {
  status?: unknown;
}

interface WorkspaceHomeTextCaptureApiProcessingState {
  fields?: {
    summary?: WorkspaceHomeTextCaptureProcessingFieldState;
    tags?: WorkspaceHomeTextCaptureProcessingFieldState;
    title?: WorkspaceHomeTextCaptureProcessingFieldState;
  };
  status?: unknown;
}

export interface WorkspaceHomeTextCaptureCreateResult {
  persistedCaptureId: string;
  processingState: WorkspaceHomeCaptureProcessingState;
}

export interface QueueWorkspaceHomeTextCaptureOptions {
  id?: string;
  queueStore?: OfflineCaptureQueueStore;
}

export interface ReplayWorkspaceHomeQueuedCapturesOptions {
  fetchImplementation?: typeof fetch;
  queueStore?: OfflineCaptureQueueStore;
}

export interface ReplayWorkspaceHomeQueuedCaptureSuccess {
  localCaptureId: string;
  persistedCaptureId: string;
  processingState: WorkspaceHomeCaptureProcessingState;
}

export interface ReplayWorkspaceHomeQueuedCaptureFailure {
  error: unknown;
  localCaptureId: string;
}

export interface ReplayWorkspaceHomeQueuedCapturesResult {
  failures: readonly ReplayWorkspaceHomeQueuedCaptureFailure[];
  synced: readonly ReplayWorkspaceHomeQueuedCaptureSuccess[];
}

export class WorkspaceHomeTextCaptureCreateStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Capture request failed with status ${status}`);
    this.name = "WorkspaceHomeTextCaptureCreateStatusError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createWorkspaceHomeTextCapturePayload(
  rawContent: string,
): OfflineCaptureQueuePayload {
  const normalizedCapture = normalizeUrlDetectedCapture({
    rawContent,
    sourceType: "TEXT_NOTE",
  });

  return {
    rawContent: normalizedCapture.rawContent,
    sourceType: normalizedCapture.sourceType,
    ...(normalizedCapture.sourceUrl === undefined
      ? {}
      : { sourceUrl: normalizedCapture.sourceUrl }),
  };
}

function getWorkspaceHomeOfflineCaptureQueueStore(): OfflineCaptureQueueStore {
  if (workspaceHomeOfflineCaptureQueueStore === undefined) {
    workspaceHomeOfflineCaptureQueueStore = createOfflineCaptureQueueStore();
  }

  return workspaceHomeOfflineCaptureQueueStore;
}

function readPersistedCaptureId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(WORKSPACE_HOME_CAPTURE_CREATE_RESPONSE_ID_MISSING_ERROR);
  }

  return value;
}

function isPendingProcessingField(
  status: InspirationEnrichmentFieldStatus | undefined,
  fallbackValue: boolean,
): boolean {
  if (status === undefined) {
    return fallbackValue;
  }

  return (
    status === "PENDING" ||
    status === "PROCESSING" ||
    status === "TIMEOUT"
  );
}

function readProcessingFieldStatus(
  value: unknown,
): InspirationEnrichmentFieldStatus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  switch (value.status) {
    case "PENDING":
    case "PROCESSING":
    case "COMPLETED":
    case "FAILED":
    case "TIMEOUT":
      return value.status;
    default:
      return undefined;
  }
}

export function normalizeWorkspaceHomeCaptureProcessingState(
  value: unknown,
): WorkspaceHomeCaptureProcessingState {
  if (!isRecord(value)) {
    return WORKSPACE_HOME_PENDING_PROCESSING_STATE;
  }

  const processingState = value as WorkspaceHomeTextCaptureApiProcessingState;
  const fields = isRecord(processingState.fields)
    ? processingState.fields
    : undefined;
  const tagsStatus = readProcessingFieldStatus(fields?.tags);
  const summaryStatus = readProcessingFieldStatus(fields?.summary);
  const titleStatus = readProcessingFieldStatus(fields?.title);

  return {
    isTagsPending: isPendingProcessingField(
      tagsStatus,
      WORKSPACE_HOME_PENDING_PROCESSING_STATE.isTagsPending,
    ),
    isSummaryPending: isPendingProcessingField(
      summaryStatus,
      WORKSPACE_HOME_PENDING_PROCESSING_STATE.isSummaryPending,
    ),
    isTitlePending: isPendingProcessingField(
      titleStatus,
      WORKSPACE_HOME_PENDING_PROCESSING_STATE.isTitlePending,
    ),
    ...(typeof processingState.status === "string"
      ? { status: processingState.status }
      : {}),
    ...(tagsStatus === undefined ? {} : { tagsStatus }),
    ...(summaryStatus === undefined ? {} : { summaryStatus }),
    ...(titleStatus === undefined ? {} : { titleStatus }),
  };
}

export function parseWorkspaceHomeTextCaptureCreateResponse(
  value: unknown,
): WorkspaceHomeTextCaptureCreateResult {
  if (!isRecord(value)) {
    throw new TypeError("Capture response body must be a JSON object.");
  }

  const responseBody = value as WorkspaceHomeTextCaptureCreateResponseBody;

  return {
    persistedCaptureId: readPersistedCaptureId(responseBody.id),
    processingState: normalizeWorkspaceHomeCaptureProcessingState(
      responseBody.processingState,
    ),
  };
}

export function shouldQueueWorkspaceHomeTextCaptureFailure(
  error: unknown,
): boolean {
  if (error instanceof WorkspaceHomeTextCaptureCreateStatusError) {
    return (
      error.status >= 500 ||
      WORKSPACE_HOME_RETRYABLE_CAPTURE_CREATE_STATUS_CODES.has(error.status)
    );
  }

  return error instanceof TypeError;
}

export async function queueWorkspaceHomeTextCapture(
  rawContent: string,
  options: QueueWorkspaceHomeTextCaptureOptions = {},
): Promise<OfflineCaptureQueueRecord> {
  return (options.queueStore ?? getWorkspaceHomeOfflineCaptureQueueStore())
    .saveCapture({
      ...(options.id === undefined ? {} : { id: options.id }),
      payload: createWorkspaceHomeTextCapturePayload(rawContent),
    });
}

async function createWorkspaceHomeCaptureFromPayload(
  payload: OfflineCaptureQueuePayload,
  fetchImplementation: typeof fetch = fetch,
): Promise<WorkspaceHomeTextCaptureCreateResult> {
  const response = await fetchImplementation("/api/inspirations", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new WorkspaceHomeTextCaptureCreateStatusError(response.status);
  }

  return parseWorkspaceHomeTextCaptureCreateResponse(await response.json());
}

function readWorkspaceHomeQueuedCaptureReplayErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function replayWorkspaceHomeQueuedCaptures(
  options: ReplayWorkspaceHomeQueuedCapturesOptions = {},
): Promise<ReplayWorkspaceHomeQueuedCapturesResult> {
  const queueStore = options.queueStore ?? getWorkspaceHomeOfflineCaptureQueueStore();
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const replayResult = await replayOfflineCaptureQueue({
    queueStore,
    readFailureInput: (error) => ({
      errorMessage: readWorkspaceHomeQueuedCaptureReplayErrorMessage(error),
    }),
    replayCapture: async (capture) =>
      createWorkspaceHomeCaptureFromPayload(
        capture.payload,
        fetchImplementation,
      ),
  });

  return {
    failures: replayResult.failures,
    synced: replayResult.synced.map(
      ({
        localCaptureId,
        result,
      }): ReplayWorkspaceHomeQueuedCaptureSuccess => ({
        localCaptureId,
        persistedCaptureId: result.persistedCaptureId,
        processingState: result.processingState,
      }),
    ),
  };
}

export async function createWorkspaceHomeTextCapture(
  rawContent: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<WorkspaceHomeTextCaptureCreateResult> {
  return createWorkspaceHomeCaptureFromPayload(
    createWorkspaceHomeTextCapturePayload(rawContent),
    fetchImplementation,
  );
}
