import assert from "node:assert/strict";
import test from "node:test";

import { createReconnectReplayController } from "../apps/web/src/offline/reconnect-replay-controller.ts";
import {
  createOfflineCaptureReconnectSignalEvent,
  installOfflineCaptureReconnectSignalListener,
  OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
  type OnlineStateListenerEventTarget,
} from "../apps/web/src/offline/online-state-listener.ts";

function createDeferredPromise(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise!: () => void;

  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => {
      resolvePromise();
    },
  };
}

class FakeEventTarget implements OnlineStateListenerEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listenersForType = this.listeners.get(type) ?? new Set<EventListener>();
    listenersForType.add(listener);
    this.listeners.set(type, listenersForType);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listenersForType = this.listeners.get(type);

    if (listenersForType === undefined) {
      return;
    }

    listenersForType.delete(listener);

    if (listenersForType.size === 0) {
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event: Event): boolean {
    const listenersForType = this.listeners.get(event.type);

    if (listenersForType === undefined) {
      return true;
    }

    for (const listener of [...listenersForType]) {
      listener(event);
    }

    return true;
  }
}

function createReplayIntegrationHarness(
  options: {
    initialOnline?: boolean;
    startReplay?: () => Promise<void>;
  } = {},
): {
  connectivityEventTarget: FakeEventTarget;
  dispose: () => void;
  getStartReplayCount: () => number;
  navigatorLike: { onLine: boolean };
} {
  const connectivityEventTarget = new FakeEventTarget();
  const signalEventTarget = new FakeEventTarget();
  const navigatorLike = {
    onLine: options.initialOnline ?? true,
  };
  let startReplayCount = 0;
  const controller = createReconnectReplayController({
    isOnline: () => navigatorLike.onLine !== false,
    startReplay: async () => {
      startReplayCount += 1;
      await options.startReplay?.();
    },
  });

  signalEventTarget.addEventListener(
    OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
    controller.handleReconnectSignal,
  );

  const disposeReconnectSignalListener =
    installOfflineCaptureReconnectSignalListener({
      connectivityEventTarget,
      navigator: navigatorLike,
      signalEventTarget,
    });

  return {
    connectivityEventTarget,
    dispose: () => {
      disposeReconnectSignalListener();
      signalEventTarget.removeEventListener(
        OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
        controller.handleReconnectSignal,
      );
    },
    getStartReplayCount: () => startReplayCount,
    navigatorLike,
  };
}

test("reconnect replay starts once when connectivity transitions from offline to online", () => {
  const harness = createReplayIntegrationHarness();

  harness.navigatorLike.onLine = false;
  harness.connectivityEventTarget.dispatchEvent(new Event("offline"));
  assert.equal(harness.getStartReplayCount(), 0);

  harness.navigatorLike.onLine = true;
  harness.connectivityEventTarget.dispatchEvent(new Event("online"));
  assert.equal(harness.getStartReplayCount(), 1);

  harness.dispose();
});

test("reconnect replay does not start from online events while the app is already online", () => {
  const harness = createReplayIntegrationHarness({
    initialOnline: true,
  });

  harness.connectivityEventTarget.dispatchEvent(new Event("online"));
  harness.connectivityEventTarget.dispatchEvent(new Event("online"));

  assert.equal(harness.getStartReplayCount(), 0);

  harness.dispose();
});

test("duplicate online events after a reconnect trigger only one replay", async () => {
  const replay = createDeferredPromise();
  const harness = createReplayIntegrationHarness({
    startReplay: async () => {
      await replay.promise;
    },
  });

  harness.navigatorLike.onLine = false;
  harness.connectivityEventTarget.dispatchEvent(new Event("offline"));

  harness.navigatorLike.onLine = true;
  harness.connectivityEventTarget.dispatchEvent(new Event("online"));
  harness.connectivityEventTarget.dispatchEvent(new Event("online"));

  assert.equal(harness.getStartReplayCount(), 1);

  replay.resolve();
  await replay.promise;
  await new Promise((resolve) => setImmediate(resolve));

  harness.dispose();
});

test("reconnect replay controller starts replay at most once for duplicate notifications from the same reconnect", async () => {
  const startCalls: number[] = [];
  const firstReplay = createDeferredPromise();
  const secondReplay = createDeferredPromise();
  const replayPromises = [firstReplay, secondReplay];
  const controller = createReconnectReplayController({
    startReplay: async () => {
      startCalls.push(Date.now());
      const nextReplay = replayPromises.shift();

      if (nextReplay === undefined) {
        throw new Error("No replay promise configured for this test.");
      }

      await nextReplay.promise;
    },
  });

  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(1));
  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(1));
  assert.equal(startCalls.length, 1);

  firstReplay.resolve();
  await firstReplay.promise;
  await new Promise((resolve) => setImmediate(resolve));

  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(1));
  assert.equal(startCalls.length, 1);

  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(2));
  assert.equal(startCalls.length, 2);

  secondReplay.resolve();
  await secondReplay.promise;
});

test("reconnect replay controller queues a newer reconnect until the current replay finishes", async () => {
  const startedReconnects: number[] = [];
  const firstReplay = createDeferredPromise();
  const secondReplay = createDeferredPromise();
  const replayPromises = [firstReplay, secondReplay];
  let nextReconnectId = 1;
  const controller = createReconnectReplayController({
    startReplay: async () => {
      startedReconnects.push(nextReconnectId);
      const nextReplay = replayPromises.shift();

      if (nextReplay === undefined) {
        throw new Error("No replay promise configured for this test.");
      }

      await nextReplay.promise;
      nextReconnectId += 1;
    },
  });

  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(1));
  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(2));
  controller.handleReconnectSignal(createOfflineCaptureReconnectSignalEvent(2));

  assert.deepEqual(startedReconnects, [1]);

  firstReplay.resolve();
  await firstReplay.promise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(startedReconnects, [1, 2]);

  secondReplay.resolve();
  await secondReplay.promise;
});
