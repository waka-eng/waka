export const OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT =
  "waka:offline-capture-reconnect";

export interface OfflineCaptureReconnectSignalDetail {
  reconnectId: number;
}

export interface OnlineStateListenerEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent?(event: Event): boolean;
}

export interface OnlineStateListenerNavigator {
  onLine?: boolean;
}

export interface InstallOfflineCaptureReconnectSignalListenerOptions {
  connectivityEventTarget?: OnlineStateListenerEventTarget;
  navigator?: OnlineStateListenerNavigator;
  signalEventTarget?: OnlineStateListenerEventTarget;
}

let offlineCaptureReconnectSignalSequence = 0;

function readOnlineState(navigatorLike: OnlineStateListenerNavigator): boolean {
  return navigatorLike.onLine !== false;
}

function createNextOfflineCaptureReconnectSignalId(): number {
  offlineCaptureReconnectSignalSequence += 1;

  return offlineCaptureReconnectSignalSequence;
}

export function createOfflineCaptureReconnectSignalEvent(
  reconnectId: number = createNextOfflineCaptureReconnectSignalId(),
): Event {
  return new CustomEvent<OfflineCaptureReconnectSignalDetail>(
    OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
    {
      detail: {
        reconnectId,
      },
    },
  );
}

export function readOfflineCaptureReconnectSignalId(event: Event): number | null {
  if (!("detail" in event)) {
    return null;
  }

  const detail = (event as Event & { detail?: unknown }).detail;

  if (
    typeof detail !== "object" ||
    detail === null ||
    typeof (detail as { reconnectId?: unknown }).reconnectId !== "number" ||
    !Number.isSafeInteger((detail as { reconnectId: number }).reconnectId) ||
    (detail as { reconnectId: number }).reconnectId < 1
  ) {
    return null;
  }

  return (detail as { reconnectId: number }).reconnectId;
}

export function dispatchOfflineCaptureReconnectSignal(
  eventTarget: OnlineStateListenerEventTarget = window,
  reconnectId?: number,
): void {
  eventTarget.dispatchEvent?.(
    createOfflineCaptureReconnectSignalEvent(reconnectId),
  );
}

export function installOfflineCaptureReconnectSignalListener(
  options: InstallOfflineCaptureReconnectSignalListenerOptions = {},
): () => void {
  const connectivityEventTarget = options.connectivityEventTarget ?? window;
  const navigatorLike = options.navigator ?? navigator;
  const signalEventTarget =
    options.signalEventTarget ?? connectivityEventTarget;
  let wasOnline = readOnlineState(navigatorLike);

  const handleConnectivityChange: EventListener = () => {
    const isOnline = readOnlineState(navigatorLike);
    const shouldDispatchReconnect = wasOnline === false && isOnline === true;

    wasOnline = isOnline;

    if (!shouldDispatchReconnect) {
      return;
    }

    dispatchOfflineCaptureReconnectSignal(signalEventTarget);
  };

  connectivityEventTarget.addEventListener("online", handleConnectivityChange);
  connectivityEventTarget.addEventListener(
    "offline",
    handleConnectivityChange,
  );

  return () => {
    connectivityEventTarget.removeEventListener(
      "online",
      handleConnectivityChange,
    );
    connectivityEventTarget.removeEventListener(
      "offline",
      handleConnectivityChange,
    );
  };
}
