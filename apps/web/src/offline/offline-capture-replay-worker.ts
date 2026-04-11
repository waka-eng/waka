import type {
  MarkOfflineCaptureFailureInput,
  OfflineCaptureReplayAttempt,
  OfflineCaptureQueueRecord,
  OfflineCaptureQueueStore,
} from "./offline-capture-queue-store.ts";

export interface ReplayOfflineCaptureQueueOptions<TResult> {
  queueStore: OfflineCaptureQueueStore;
  readFailureInput?: (error: unknown) => MarkOfflineCaptureFailureInput;
  replayCapture: (capture: OfflineCaptureQueueRecord) => Promise<TResult>;
}

export interface ReplayOfflineCaptureQueueFailure {
  error: unknown;
  localCaptureId: string;
}

export interface ReplayOfflineCaptureQueueSuccess<TResult> {
  localCaptureId: string;
  result: TResult;
}

export interface ReplayOfflineCaptureQueueResult<TResult> {
  failures: readonly ReplayOfflineCaptureQueueFailure[];
  synced: readonly ReplayOfflineCaptureQueueSuccess<TResult>[];
}

function createDefaultReplayFailureInput(
  error: unknown,
): MarkOfflineCaptureFailureInput {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
    };
  }

  return {
    errorMessage: String(error),
  };
}

function createReplayAttempt(
  capture: OfflineCaptureQueueRecord,
): OfflineCaptureReplayAttempt {
  return {
    attemptCount: capture.retry.attemptCount,
    lastAttemptAt: capture.retry.lastAttemptAt,
  };
}

export async function replayOfflineCaptureQueue<TResult>(
  options: ReplayOfflineCaptureQueueOptions<TResult>,
): Promise<ReplayOfflineCaptureQueueResult<TResult>> {
  const readFailureInput =
    options.readFailureInput ?? createDefaultReplayFailureInput;
  const pendingCaptures = await options.queueStore.listPendingCaptures();
  const synced: ReplayOfflineCaptureQueueSuccess<TResult>[] = [];
  const failures: ReplayOfflineCaptureQueueFailure[] = [];

  for (const pendingCapture of pendingCaptures) {
    const syncingCapture = await options.queueStore.markCaptureSyncing(
      pendingCapture.id,
    );

    if (syncingCapture === null) {
      continue;
    }

    const replayAttempt = createReplayAttempt(syncingCapture);

    try {
      const result = await options.replayCapture(syncingCapture);
      const syncedCapture = await options.queueStore.markCaptureSynced(
        syncingCapture.id,
        undefined,
        replayAttempt,
      );
      const wasRemovedAfterSync =
        syncedCapture === null &&
        (await options.queueStore.getCapture(syncingCapture.id)) === null;

      if (syncedCapture !== null || wasRemovedAfterSync) {
        synced.push({
          localCaptureId: syncingCapture.id,
          result,
        });
      }
    } catch (error) {
      const failedCapture = await options.queueStore.markCaptureFailed(
        syncingCapture.id,
        readFailureInput(error),
        replayAttempt,
      );

      if (failedCapture !== null) {
        failures.push({
          error,
          localCaptureId: syncingCapture.id,
        });
      }
    }
  }

  return {
    failures,
    synced,
  };
}
