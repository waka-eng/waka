import assert from "node:assert/strict";
import test from "node:test";

import {
  createServiceWorkerSkipWaitingMessage,
  registerProductionServiceWorker,
  shouldRegisterProductionServiceWorker,
  WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE,
  WAKA_SERVICE_WORKER_PATH,
  WAKA_SERVICE_WORKER_SCOPE,
} from "../apps/web/src/pwa/service-worker-registration.ts";

test("service worker registration only runs in production when the browser supports it", () => {
  assert.equal(
    shouldRegisterProductionServiceWorker("production", true),
    true,
  );
  assert.equal(
    shouldRegisterProductionServiceWorker("development", true),
    false,
  );
  assert.equal(
    shouldRegisterProductionServiceWorker("production", false),
    false,
  );
});

test("production service worker registration targets the root scope", async () => {
  const expectedRegistration = {
    installing: null,
    waiting: null,
  };
  const registrations: Array<{
    options:
      | {
          scope?: string;
        }
      | undefined;
    scriptUrl: string;
  }> = [];

  const registered = await registerProductionServiceWorker(
    {
      async register(scriptUrl, options) {
        registrations.push({
          options,
          scriptUrl,
        });

        return expectedRegistration;
      },
    },
    "production",
  );

  assert.equal(registered, expectedRegistration);
  assert.deepEqual(registrations, [
    {
      options: {
        scope: WAKA_SERVICE_WORKER_SCOPE,
      },
      scriptUrl: WAKA_SERVICE_WORKER_PATH,
    },
  ]);
});

test("non-production environments skip service worker registration", async () => {
  let registerCalled = false;

  const registered = await registerProductionServiceWorker(
    {
      async register() {
        registerCalled = true;
        return {};
      },
    },
    "development",
  );

  assert.equal(registered, false);
  assert.equal(registerCalled, false);
});

test("missing service worker support skips registration cleanly", async () => {
  await assert.doesNotReject(
    registerProductionServiceWorker(undefined, "production"),
  );
  assert.equal(
    await registerProductionServiceWorker(undefined, "production"),
    false,
  );
});

test("service worker skip-waiting messages use a stable contract shared with the worker runtime", () => {
  assert.equal(
    createServiceWorkerSkipWaitingMessage().type,
    WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE,
  );
});
