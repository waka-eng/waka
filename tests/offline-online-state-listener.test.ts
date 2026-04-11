import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createOfflineCaptureReconnectSignalEvent,
  installOfflineCaptureReconnectSignalListener,
  OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
  readOfflineCaptureReconnectSignalId,
  type OnlineStateListenerEventTarget,
} from "../apps/web/src/offline/online-state-listener.ts";

const WORKSPACE_HOME_SHELL_CONTEXT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-shell-context.tsx",
);

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

  getListenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

test("installOfflineCaptureReconnectSignalListener emits one reconnect signal for each offline to online transition", () => {
  const connectivityEventTarget = new FakeEventTarget();
  const signalEventTarget = new FakeEventTarget();
  const navigatorLike = {
    onLine: true,
  };
  const reconnectSignals: string[] = [];

  signalEventTarget.addEventListener(
    OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
    () => {
      reconnectSignals.push("reconnected");
    },
  );

  const dispose = installOfflineCaptureReconnectSignalListener({
    connectivityEventTarget,
    navigator: navigatorLike,
    signalEventTarget,
  });

  connectivityEventTarget.dispatchEvent(new Event("online"));
  assert.deepEqual(reconnectSignals, []);

  navigatorLike.onLine = false;
  connectivityEventTarget.dispatchEvent(new Event("offline"));
  connectivityEventTarget.dispatchEvent(new Event("offline"));
  assert.deepEqual(reconnectSignals, []);

  navigatorLike.onLine = true;
  connectivityEventTarget.dispatchEvent(new Event("online"));
  connectivityEventTarget.dispatchEvent(new Event("online"));
  assert.deepEqual(reconnectSignals, ["reconnected"]);

  navigatorLike.onLine = false;
  connectivityEventTarget.dispatchEvent(new Event("offline"));
  navigatorLike.onLine = true;
  connectivityEventTarget.dispatchEvent(new Event("online"));
  assert.deepEqual(reconnectSignals, ["reconnected", "reconnected"]);

  dispose();
});

test("offline reconnect signals carry a stable reconnect id for deduplicating duplicate notifications", () => {
  const signalEventTarget = new FakeEventTarget();
  const reconnectIds: number[] = [];

  signalEventTarget.addEventListener(
    OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
    (event) => {
      const reconnectId = readOfflineCaptureReconnectSignalId(event);
      assert.notEqual(reconnectId, null);
      reconnectIds.push(reconnectId);
    },
  );

  signalEventTarget.dispatchEvent(createOfflineCaptureReconnectSignalEvent(7));
  signalEventTarget.dispatchEvent(createOfflineCaptureReconnectSignalEvent(7));
  signalEventTarget.dispatchEvent(createOfflineCaptureReconnectSignalEvent(8));

  assert.deepEqual(reconnectIds, [7, 7, 8]);
});

test("installOfflineCaptureReconnectSignalListener removes connectivity listeners during cleanup", () => {
  const connectivityEventTarget = new FakeEventTarget();
  const signalEventTarget = new FakeEventTarget();
  const navigatorLike = {
    onLine: false,
  };
  let reconnectCount = 0;

  signalEventTarget.addEventListener(
    OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
    () => {
      reconnectCount += 1;
    },
  );

  const dispose = installOfflineCaptureReconnectSignalListener({
    connectivityEventTarget,
    navigator: navigatorLike,
    signalEventTarget,
  });

  assert.equal(connectivityEventTarget.getListenerCount("online"), 1);
  assert.equal(connectivityEventTarget.getListenerCount("offline"), 1);

  dispose();

  assert.equal(connectivityEventTarget.getListenerCount("online"), 0);
  assert.equal(connectivityEventTarget.getListenerCount("offline"), 0);

  navigatorLike.onLine = true;
  connectivityEventTarget.dispatchEvent(new Event("online"));
  assert.equal(reconnectCount, 0);
});

test("installOfflineCaptureReconnectSignalListener emits a reconnect signal when the app starts offline and comes back online", () => {
  const connectivityEventTarget = new FakeEventTarget();
  const signalEventTarget = new FakeEventTarget();
  const navigatorLike = {
    onLine: false,
  };
  let reconnectCount = 0;

  signalEventTarget.addEventListener(
    OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
    () => {
      reconnectCount += 1;
    },
  );

  const dispose = installOfflineCaptureReconnectSignalListener({
    connectivityEventTarget,
    navigator: navigatorLike,
    signalEventTarget,
  });

  navigatorLike.onLine = true;
  connectivityEventTarget.dispatchEvent(new Event("online"));
  assert.equal(reconnectCount, 1);

  dispose();
});

test("workspace home shell provider installs the reconnect signal listener for authenticated app views", () => {
  const source = readFileSync(WORKSPACE_HOME_SHELL_CONTEXT_PATH, "utf8");

  assert.match(source, /installOfflineCaptureReconnectSignalListener/u);
  assert.match(source, /useEffect/u);
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*return installOfflineCaptureReconnectSignalListener\(\);\s*\}, \[\]\);/u,
  );
});
