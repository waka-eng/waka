import assert from "node:assert/strict";
import test from "node:test";

import {
  registerProductionServiceWorkerOnClient,
  scheduleProductionServiceWorkerRegistrationOnClient,
  type ServiceWorkerClientRegistrationCleanup,
  type ServiceWorkerRegistrationWindowTarget,
} from "../apps/web/src/pwa/service-worker-client-registration.ts";
import {
  createServiceWorkerSkipWaitingMessage,
  WAKA_SERVICE_WORKER_PATH,
  WAKA_SERVICE_WORKER_SCOPE,
} from "../apps/web/src/pwa/service-worker-registration.ts";

class MockEventTarget<TEventName extends string> {
  private readonly listeners = new Map<TEventName, Set<() => void>>();

  addEventListener(type: TEventName, listener: () => void): void {
    const listenersForType = this.listeners.get(type) ?? new Set<() => void>();

    listenersForType.add(listener);
    this.listeners.set(type, listenersForType);
  }

  dispatch(type: TEventName): void {
    const listenersForType = this.listeners.get(type);

    if (listenersForType === undefined) {
      return;
    }

    for (const listener of listenersForType) {
      listener();
    }
  }

  getListenerCount(type: TEventName): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  removeEventListener(type: TEventName, listener: () => void): void {
    const listenersForType = this.listeners.get(type);

    if (listenersForType === undefined) {
      return;
    }

    listenersForType.delete(listener);

    if (listenersForType.size === 0) {
      this.listeners.delete(type);
    }
  }
}

class MockServiceWorkerRuntime extends MockEventTarget<"statechange"> {
  readonly messages: Array<{ type: string }> = [];
  state: string;

  constructor(state: string) {
    super();
    this.state = state;
  }

  postMessage(message: { type: string }): void {
    this.messages.push(message);
  }
}

class MockServiceWorkerRegistration extends MockEventTarget<"updatefound"> {
  installing: MockServiceWorkerRuntime | null = null;
  waiting: MockServiceWorkerRuntime | null = null;
}

class MockServiceWorkerContainer extends MockEventTarget<"controllerchange"> {
  readonly registrations: Array<{
    options:
      | {
          scope?: string;
        }
      | undefined;
    scriptUrl: string;
  }> = [];
  readonly controller: unknown;
  private readonly registration: MockServiceWorkerRegistration;

  constructor(
    registration: MockServiceWorkerRegistration,
    controller: unknown = {
      type: "existing-controller",
    },
  ) {
    super();
    this.registration = registration;
    this.controller = controller;
  }

  async register(
    scriptUrl: string,
    options?: {
      scope?: string;
    },
  ): Promise<MockServiceWorkerRegistration> {
    this.registrations.push({
      options,
      scriptUrl,
    });

    return this.registration;
  }
}

class MockWindow
  extends MockEventTarget<"load" | "pagehide">
  implements ServiceWorkerRegistrationWindowTarget
{
  readonly location = {
    reload: () => {
      this.reloadCalls += 1;
    },
  };
  reloadCalls = 0;

  private nextTimeoutId = 1;
  private readonly scheduledTimeouts = new Map<number, () => void>();

  clearTimeout(timeoutId: number): void {
    this.scheduledTimeouts.delete(timeoutId);
  }

  runTimeout(timeoutId: number): void {
    const callback = this.scheduledTimeouts.get(timeoutId);

    if (callback === undefined) {
      return;
    }

    this.scheduledTimeouts.delete(timeoutId);
    callback();
  }

  setTimeout(callback: () => void, _delay?: number): number {
    const timeoutId = this.nextTimeoutId;

    this.nextTimeoutId += 1;
    this.scheduledTimeouts.set(timeoutId, callback);

    return timeoutId;
  }
}

test("client helper registers the service worker in production browsers", async () => {
  const registration = new MockServiceWorkerRegistration();
  const serviceWorker = new MockServiceWorkerContainer(registration);
  const browserWindow = new MockWindow();

  const cleanup = await registerProductionServiceWorkerOnClient(
    {
      serviceWorker,
    },
    "production",
    browserWindow,
  );

  assert.notEqual(cleanup, false);
  assert.deepEqual(serviceWorker.registrations, [
    {
      options: {
        scope: WAKA_SERVICE_WORKER_SCOPE,
      },
      scriptUrl: WAKA_SERVICE_WORKER_PATH,
    },
  ]);

  cleanup();

  assert.equal(serviceWorker.getListenerCount("controllerchange"), 0);
  assert.equal(registration.getListenerCount("updatefound"), 0);
  assert.equal(browserWindow.getListenerCount("pagehide"), 0);
});

test("client helper skips registration outside production builds", async () => {
  const registration = new MockServiceWorkerRegistration();
  const serviceWorker = new MockServiceWorkerContainer(registration);

  const cleanup = await registerProductionServiceWorkerOnClient(
    {
      serviceWorker,
    },
    "development",
  );

  assert.equal(cleanup, false);
  assert.deepEqual(serviceWorker.registrations, []);
});

test("client helper skips registration when the browser lacks service worker support", async () => {
  assert.equal(
    await registerProductionServiceWorkerOnClient({}, "production"),
    false,
  );
  assert.equal(
    await registerProductionServiceWorkerOnClient(undefined, "production"),
    false,
  );
});

test("client helper activates a waiting worker from a previous session and reloads once when control changes", async () => {
  const waitingWorker = new MockServiceWorkerRuntime("installed");
  const registration = new MockServiceWorkerRegistration();

  registration.waiting = waitingWorker;

  const serviceWorker = new MockServiceWorkerContainer(registration);
  const browserWindow = new MockWindow();
  const cleanup = await registerProductionServiceWorkerOnClient(
    {
      serviceWorker,
    },
    "production",
    browserWindow,
  );

  assert.notEqual(cleanup, false);
  assert.deepEqual(waitingWorker.messages, [
    createServiceWorkerSkipWaitingMessage(),
  ]);

  serviceWorker.dispatch("controllerchange");
  serviceWorker.dispatch("controllerchange");

  assert.equal(browserWindow.reloadCalls, 1);

  cleanup();

  assert.equal(serviceWorker.getListenerCount("controllerchange"), 0);
  assert.equal(registration.getListenerCount("updatefound"), 0);
  assert.equal(browserWindow.getListenerCount("pagehide"), 0);
});

test("client helper defers newly found updates until the page hides so active capture is not interrupted mid-session", async () => {
  const registration = new MockServiceWorkerRegistration();
  const serviceWorker = new MockServiceWorkerContainer(registration);
  const browserWindow = new MockWindow();
  const cleanup = await registerProductionServiceWorkerOnClient(
    {
      serviceWorker,
    },
    "production",
    browserWindow,
  );

  assert.notEqual(cleanup, false);

  const installingWorker = new MockServiceWorkerRuntime("installing");

  registration.installing = installingWorker;
  registration.dispatch("updatefound");
  registration.waiting = installingWorker;
  installingWorker.state = "installed";
  installingWorker.dispatch("statechange");

  assert.deepEqual(installingWorker.messages, []);

  browserWindow.dispatch("pagehide");

  assert.deepEqual(installingWorker.messages, [
    createServiceWorkerSkipWaitingMessage(),
  ]);

  serviceWorker.dispatch("controllerchange");

  assert.equal(browserWindow.reloadCalls, 0);

  cleanup();

  assert.equal(installingWorker.getListenerCount("statechange"), 0);
});

test("client entrypoint waits for the browser load event while the app is still bootstrapping", async () => {
  let registerCalls = 0;
  let registrationCleanupCalls = 0;
  let loadListener: (() => void) | undefined;
  const removedListeners: Array<() => void> = [];

  const cleanup = scheduleProductionServiceWorkerRegistrationOnClient({
    browserDocument: {
      readyState: "interactive",
    },
    browserNavigator: {
      serviceWorker: new MockServiceWorkerContainer(
        new MockServiceWorkerRegistration(),
      ),
    },
    browserWindow: {
      addEventListener(_type, listener, options) {
        assert.deepEqual(options, {
          once: true,
        });
        loadListener = listener;
      },
      clearTimeout() {
        throw new Error("bootstrap path should not schedule a timer before load");
      },
      removeEventListener(_type, listener) {
        removedListeners.push(listener);
      },
      setTimeout() {
        throw new Error("bootstrap path should wait for the load event");
      },
    },
    env: "production",
    async registerServiceWorker() {
      registerCalls += 1;
      return () => {
        registrationCleanupCalls += 1;
      };
    },
  });

  assert.equal(registerCalls, 0);
  assert.ok(loadListener);

  loadListener?.();

  assert.equal(registerCalls, 1);

  cleanup();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(removedListeners, [loadListener]);
  assert.equal(registrationCleanupCalls, 1);
});

test("client entrypoint schedules service worker registration after bootstrap completes", async () => {
  let registerCalls = 0;
  let registrationCleanupCalls = 0;
  let scheduledCallback: (() => void) | undefined;
  let clearedTimeoutId = -1;

  const cleanup = scheduleProductionServiceWorkerRegistrationOnClient({
    browserDocument: {
      readyState: "complete",
    },
    browserNavigator: {
      serviceWorker: new MockServiceWorkerContainer(
        new MockServiceWorkerRegistration(),
      ),
    },
    browserWindow: {
      addEventListener() {
        throw new Error("completed bootstrap should not wait for load");
      },
      clearTimeout(timeoutId) {
        clearedTimeoutId = timeoutId;
      },
      removeEventListener() {
        throw new Error("completed bootstrap should not install a load listener");
      },
      setTimeout(callback, delay) {
        assert.equal(delay, 0);
        scheduledCallback = callback;
        return 42;
      },
    },
    env: "production",
    async registerServiceWorker() {
      registerCalls += 1;
      return () => {
        registrationCleanupCalls += 1;
      };
    },
  });

  assert.equal(registerCalls, 0);
  assert.ok(scheduledCallback);

  scheduledCallback?.();

  assert.equal(registerCalls, 1);

  cleanup();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(clearedTimeoutId, 42);
  assert.equal(registrationCleanupCalls, 1);
});

test("client entrypoint cleans up registration listeners even if the component unmounts before registration resolves", async () => {
  let resolveRegistration:
    | ((cleanup: ServiceWorkerClientRegistrationCleanup | false) => void)
    | undefined;
  let registrationCleanupCalls = 0;
  let scheduledCallback: (() => void) | undefined;

  const cleanup = scheduleProductionServiceWorkerRegistrationOnClient({
    browserDocument: {
      readyState: "complete",
    },
    browserNavigator: {
      serviceWorker: new MockServiceWorkerContainer(
        new MockServiceWorkerRegistration(),
      ),
    },
    browserWindow: {
      addEventListener() {
        throw new Error("completed bootstrap should not wait for load");
      },
      clearTimeout() {
        return undefined;
      },
      removeEventListener() {
        throw new Error("completed bootstrap should not install a load listener");
      },
      setTimeout(callback) {
        scheduledCallback = callback;
        return 1;
      },
    },
    env: "production",
    registerServiceWorker() {
      return new Promise((resolve) => {
        resolveRegistration = resolve;
      });
    },
  });

  scheduledCallback?.();
  cleanup();
  resolveRegistration?.(() => {
    registrationCleanupCalls += 1;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(registrationCleanupCalls, 1);
});

test("client entrypoint swallows non-fatal service worker registration failures", async () => {
  let scheduledCallback: (() => void) | undefined;
  const unhandledRejections: unknown[] = [];
  const handleUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  process.on("unhandledRejection", handleUnhandledRejection);

  try {
    scheduleProductionServiceWorkerRegistrationOnClient({
      browserDocument: {
        readyState: "complete",
      },
      browserNavigator: {
        serviceWorker: new MockServiceWorkerContainer(
          new MockServiceWorkerRegistration(),
        ),
      },
      browserWindow: {
        addEventListener() {
          throw new Error("completed bootstrap should schedule a timer instead");
        },
        clearTimeout() {
          return undefined;
        },
        removeEventListener() {
          throw new Error("completed bootstrap should not install a load listener");
        },
        setTimeout(callback) {
          scheduledCallback = callback;
          return 1;
        },
      },
      env: "production",
      async registerServiceWorker() {
        throw new Error("registration failed");
      },
    });

    scheduledCallback?.();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("unhandledRejection", handleUnhandledRejection);
  }
});
