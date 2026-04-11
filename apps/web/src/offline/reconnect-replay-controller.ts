import { readOfflineCaptureReconnectSignalId } from "./online-state-listener.ts";

export interface CreateReconnectReplayControllerOptions {
  isOnline?: () => boolean;
  startReplay: () => Promise<void>;
}

export interface ReconnectReplayController {
  handleReconnectSignal: EventListener;
}

export function createReconnectReplayController(
  options: CreateReconnectReplayControllerOptions,
): ReconnectReplayController {
  const isOnline = options.isOnline ?? (() => true);
  let currentReplayReconnectId: number | null = null;
  let lastCompletedReconnectId = 0;
  let pendingReconnectId: number | null = null;

  const flushPendingReplay = (): void => {
    if (currentReplayReconnectId !== null || pendingReconnectId === null) {
      return;
    }

    if (!isOnline()) {
      return;
    }

    const reconnectId = pendingReconnectId;
    pendingReconnectId = null;
    currentReplayReconnectId = reconnectId;

    void options.startReplay().finally(() => {
      lastCompletedReconnectId = Math.max(lastCompletedReconnectId, reconnectId);
      currentReplayReconnectId = null;
      flushPendingReplay();
    });
  };

  const handleReconnectSignal: EventListener = (event) => {
    if (!isOnline()) {
      return;
    }

    const reconnectId = readOfflineCaptureReconnectSignalId(event);

    if (reconnectId === null) {
      pendingReconnectId = Math.max(
        pendingReconnectId ?? 0,
        currentReplayReconnectId ?? 0,
        lastCompletedReconnectId,
      ) + 1;
      flushPendingReplay();
      return;
    }

    if (
      reconnectId <= lastCompletedReconnectId ||
      reconnectId === currentReplayReconnectId ||
      reconnectId === pendingReconnectId
    ) {
      return;
    }

    pendingReconnectId = Math.max(pendingReconnectId ?? 0, reconnectId);
    flushPendingReplay();
  };

  return {
    handleReconnectSignal,
  };
}
