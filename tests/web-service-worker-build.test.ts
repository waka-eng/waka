import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH,
  WAKA_APP_SHELL_ROUTE_PATHS,
  WAKA_SERVICE_WORKER_PRECACHE_PATHS,
} from "../apps/web/src/pwa/install-metadata.ts";
import {
  WEB_SERVICE_WORKER_OUTPUT_PATH,
  WEB_SERVICE_WORKER_CACHE_VERSION_PLACEHOLDER,
  WEB_SERVICE_WORKER_DEFAULT_NAVIGATION_PATH_PLACEHOLDER,
  WEB_SERVICE_WORKER_PRECACHED_PATHS_PLACEHOLDER,
  WEB_SERVICE_WORKER_ROUTE_PATHS_PLACEHOLDER,
  WEB_SERVICE_WORKER_TEMPLATE_PATH,
  createWebServiceWorkerCacheVersion,
  prepareWebServiceWorker,
  prepareWebServiceWorkerSource,
} from "../scripts/prepare-web-service-worker.ts";

test("web build preparation copies the service worker template into public/sw.js", async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "waka-sw-build-"));
  const webAppRoot = path.join(temporaryRoot, "apps", "web");
  const templatePath = path.join(webAppRoot, WEB_SERVICE_WORKER_TEMPLATE_PATH);
  const outputPath = path.join(webAppRoot, WEB_SERVICE_WORKER_OUTPUT_PATH);
  const templateSource = "self.addEventListener(\"install\", () => undefined);\n";

  mkdirSync(path.dirname(templatePath), {
    recursive: true,
  });
  mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  writeFileSync(templatePath, templateSource, "utf8");
  writeFileSync(outputPath, "stale-output", "utf8");

  const preparedPath = await prepareWebServiceWorker(webAppRoot);

  assert.equal(preparedPath, outputPath);
  assert.equal(readFileSync(outputPath, "utf8"), templateSource);
});

test("web build preparation stamps a deterministic cache version into the generated service worker", () => {
  const templateSource = [
    "const CACHE = \"waka-app-shell-__WAKA_APP_SHELL_CACHE_VERSION__\";",
    "const DEFAULT_NAVIGATION_PATH = __WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH__;",
    "const ROUTE_PATHS = __WAKA_APP_SHELL_ROUTE_PATHS__;",
    "const PRECACHED_PATHS = __WAKA_APP_SHELL_PRECACHED_PATHS__;",
    "self.addEventListener(\"install\", () => undefined);",
    "",
  ].join("\n");

  const preparedSource = prepareWebServiceWorkerSource(templateSource);

  assert.doesNotMatch(
    preparedSource,
    new RegExp(WEB_SERVICE_WORKER_CACHE_VERSION_PLACEHOLDER, "u"),
  );
  assert.match(preparedSource, /waka-app-shell-[0-9a-f]{12}/u);
  assert.equal(
    preparedSource,
    prepareWebServiceWorkerSource(templateSource),
  );
  assert.doesNotMatch(
    preparedSource,
    new RegExp(WEB_SERVICE_WORKER_DEFAULT_NAVIGATION_PATH_PLACEHOLDER, "u"),
  );
  assert.doesNotMatch(
    preparedSource,
    new RegExp(WEB_SERVICE_WORKER_ROUTE_PATHS_PLACEHOLDER, "u"),
  );
  assert.doesNotMatch(
    preparedSource,
    new RegExp(WEB_SERVICE_WORKER_PRECACHED_PATHS_PLACEHOLDER, "u"),
  );
  assert.match(
    preparedSource,
    new RegExp(createWebServiceWorkerCacheVersion(templateSource), "u"),
  );
});

test("generated service worker precaches install-critical assets and uses a timed navigation fallback to the cached app shell", () => {
  const source = readFileSync("apps/web/public/sw.js", "utf8");

  assert.match(source, /const WAKA_APP_SHELL_CACHE_PREFIX = "waka-app-shell";/u);
  assert.match(source, /const WAKA_APP_SHELL_CACHE_VERSION = "[0-9a-f]{12}";/u);
  assert.match(
    source,
    new RegExp(
      `const WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH =\\s*${escapeRegExp(
        JSON.stringify(WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH),
      )};`,
      "u",
    ),
  );
  assert.match(
    source,
    /const WAKA_APP_SHELL_NAVIGATION_TIMEOUT_MS = 3000;/u,
  );
  assert.match(
    source,
    new RegExp(
      `const WAKA_APP_SHELL_ROUTE_PATHS = ${escapeRegExp(
        JSON.stringify(WAKA_APP_SHELL_ROUTE_PATHS),
      )};`,
      "u",
    ),
  );
  assert.match(
    source,
    new RegExp(
      `const WAKA_APP_SHELL_PRECACHED_PATHS = ${escapeRegExp(
        JSON.stringify(WAKA_SERVICE_WORKER_PRECACHE_PATHS),
      )};`,
      "u",
    ),
  );
  assert.match(source, /cache\.addAll\(WAKA_APP_SHELL_ASSET_REQUESTS\)/u);
  assert.match(source, /new Request\(assetPath,\s*\{\s*cache:\s*"reload"\s*\}\)/u);
  assert.match(
    source,
    /const WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE =\s*"waka:service-worker:skip-waiting";/u,
  );
  assert.match(source, /\/manifest\.webmanifest/u);
  assert.match(source, /\/icons\/apple-touch-icon\.png/u);
  assert.match(source, /\/icons\/apple-touch-icon-167\.png/u);
  assert.match(source, /\/icons\/apple-touch-icon-152\.png/u);
  assert.match(source, /\/icons\/apple-touch-icon-120\.png/u);
  assert.match(source, /\/icons\/icon-maskable-512\.png/u);
  assert.match(source, /\/dashboard/u);
  assert.match(source, /\/settings/u);
  assert.match(source, /self\.addEventListener\("message", \(event\) => \{/u);
  assert.match(source, /event\.waitUntil\(self\.skipWaiting\(\)\);/u);
  assert.doesNotMatch(source, /\.then\(\(\) => self\.skipWaiting\(\)\)/u);
  assert.match(
    source,
    /request\.mode === "navigate"/u,
  );
  assert.match(
    source,
    /event\.respondWith\(respondToNavigationRequest\(request,\s*requestUrl\)\)/u,
  );
  assert.match(source, /const cachedResponse = await caches\.match\(cacheKey\);/u);
  assert.match(
    source,
    /responseUrl\.origin === self\.location\.origin && responseUrl\.pathname === cacheKey/u,
  );
  assert.match(
    source,
    /const timeoutId = setTimeout\(\(\) => abortController\.abort\(\), timeoutMs\);/u,
  );
  assert.match(
    source,
    /return await fetch\(request,\s*\{\s*signal: abortController\.signal,\s*\}\);/u,
  );
  assert.match(
    source,
    /const navigationFallbackCacheKey = getNavigationFallbackCacheKey\(requestUrl\);/u,
  );
  assert.match(
    source,
    /\(await caches\.match\(requestUrl\.pathname\)\) \?\?\s*\(await caches\.match\(navigationFallbackCacheKey\)\)/u,
  );
  assert.match(
    source,
    /cacheKey\.startsWith\(WAKA_APP_SHELL_CACHE_PREFIX\)\s*&&\s*cacheKey !== WAKA_APP_SHELL_CACHE/u,
  );
});

test("generated service worker only skips waiting after an explicit client activation message", async () => {
  const ignoredMessage = await dispatchServiceWorkerMessage({
    message: {
      type: "waka:service-worker:noop",
    },
  });
  const promotedMessage = await dispatchServiceWorkerMessage({
    message: {
      type: "waka:service-worker:skip-waiting",
    },
  });

  assert.equal(ignoredMessage.skipWaitingCalls, 0);
  assert.equal(promotedMessage.skipWaitingCalls, 1);
});

test("generated service worker falls back to the cached dashboard shell when a deep-link navigation request fails offline", async () => {
  const { cacheMatches, response } = await dispatchServiceWorkerFetch({
    cacheResponses: new Map([
      ["/dashboard", new Response("cached-dashboard-shell")],
    ]),
    fetch: async () => {
      throw new TypeError("offline");
    },
    request: createNavigationRequest("https://waka.test/inspirations/cm8deep"),
  });

  assert.deepEqual(cacheMatches, ["/inspirations/cm8deep", "/dashboard"]);
  assert.equal(await response.text(), "cached-dashboard-shell");
});

test("generated service worker aborts stalled navigation requests and returns the cached app shell", async () => {
  const timeoutDelays: number[] = [];
  const { cacheMatches, response } = await dispatchServiceWorkerFetch({
    cacheResponses: new Map([
      ["/dashboard", new Response("cached-dashboard-shell")],
    ]),
    clearTimeout: () => undefined,
    fetch: async (_request, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw new Error("aborted");
    },
    request: createNavigationRequest("https://waka.test/dashboard"),
    setTimeout(callback, delay) {
      timeoutDelays.push(delay);
      callback();

      return 1;
    },
  });

  assert.deepEqual(timeoutDelays, [3000]);
  assert.deepEqual(cacheMatches, ["/dashboard"]);
  assert.equal(await response.text(), "cached-dashboard-shell");
});

test("web workspace build prepares the service worker before next build", () => {
  const manifest = JSON.parse(
    readFileSync("apps/web/package.json", "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    manifest.scripts?.build,
    "node ../../scripts/prepare-web-icons.ts && node ../../scripts/prepare-web-manifest.ts && node ../../scripts/prepare-web-service-worker.ts && next build",
  );
});

test("next config serves the generated service worker with deploy-safe headers", () => {
  const source = readFileSync("apps/web/next.config.ts", "utf8");

  assert.match(source, /source:\s*"\/sw\.js"/u);
  assert.match(source, /Service-Worker-Allowed/u);
  assert.match(source, /Cache-Control/u);
});

type MockFetch = (
  request: unknown,
  init?: {
    signal?: AbortSignal;
  },
) => Promise<Response>;

function createNavigationRequest(url: string): {
  headers: Headers;
  method: string;
  mode: string;
  url: string;
} {
  return {
    headers: new Headers({
      accept: "text/html",
    }),
    method: "GET",
    mode: "navigate",
    url,
  };
}

async function dispatchServiceWorkerFetch(options: {
  cacheResponses?: ReadonlyMap<string, Response>;
  clearTimeout?: (timeoutId: number) => void;
  fetch: MockFetch;
  request: {
    headers?: Headers;
    method: string;
    mode: string;
    url: string;
  };
  setTimeout?: (callback: () => void, delay: number) => number;
}): Promise<{
  cacheMatches: string[];
  response: Response;
}> {
  const source = readFileSync("apps/web/public/sw.js", "utf8");
  const listeners = new Map<string, (event: unknown) => void>();
  const cacheMatches: string[] = [];

  class MockRequest {
    readonly headers: Headers;
    readonly method: string;
    readonly mode: string | undefined;
    readonly url: string;

    constructor(
      input:
        | string
        | {
            headers?: Headers;
            method?: string;
            mode?: string;
            url: string;
          },
      init: {
        headers?: HeadersInit;
        method?: string;
        mode?: string;
      } = {},
    ) {
      const requestInput =
        typeof input === "string"
          ? {
              url: input,
            }
          : input;
      const resolvedUrl =
        typeof requestInput.url === "string" &&
        requestInput.url.startsWith("http")
          ? requestInput.url
          : new URL(requestInput.url, "https://waka.test").toString();

      this.headers = new Headers(init.headers ?? requestInput.headers);
      this.method = init.method ?? requestInput.method ?? "GET";
      this.mode = init.mode ?? requestInput.mode;
      this.url = resolvedUrl;
    }
  }

  const context = {
    AbortController,
    Headers,
    Request: MockRequest,
    Response,
    URL,
    caches: {
      async delete() {
        return true;
      },
      async keys() {
        return [];
      },
      async match(key: string) {
        cacheMatches.push(key);

        return options.cacheResponses?.get(key);
      },
      async open() {
        return {
          addAll() {
            return Promise.resolve();
          },
          put() {
            return Promise.resolve();
          },
        };
      },
    },
    clearTimeout: options.clearTimeout ?? (() => undefined),
    fetch: options.fetch,
    self: {
      clients: {
        claim() {
          return Promise.resolve();
        },
      },
      location: {
        origin: "https://waka.test",
      },
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener);
      },
      skipWaiting() {
        return Promise.resolve();
      },
    },
    setTimeout:
      options.setTimeout ??
      ((callback: () => void, _delay: number) => {
        callback();

        return 1;
      }),
  };

  vm.runInNewContext(source, context);

  const fetchListener = listeners.get("fetch");

  assert.ok(fetchListener, "Service worker should register a fetch listener.");

  let responsePromise: Promise<Response> | undefined;
  fetchListener({
    request: options.request,
    respondWith(response: Promise<Response>) {
      responsePromise = response;
    },
  });

  assert.ok(
    responsePromise,
    "Fetch event handler should respond to navigation requests.",
  );

  return {
    cacheMatches,
    response: await responsePromise,
  };
}

async function dispatchServiceWorkerMessage(options: {
  message: unknown;
}): Promise<{
  skipWaitingCalls: number;
}> {
  const source = readFileSync("apps/web/public/sw.js", "utf8");
  const listeners = new Map<string, (event: unknown) => void>();
  let skipWaitingCalls = 0;

  class MockRequest {
    readonly headers: Headers;
    readonly method: string;
    readonly mode: string | undefined;
    readonly url: string;

    constructor(
      input:
        | string
        | {
            headers?: Headers;
            method?: string;
            mode?: string;
            url: string;
          },
      init: {
        headers?: HeadersInit;
        method?: string;
        mode?: string;
      } = {},
    ) {
      const requestInput =
        typeof input === "string"
          ? {
              url: input,
            }
          : input;
      const resolvedUrl =
        typeof requestInput.url === "string" &&
        requestInput.url.startsWith("http")
          ? requestInput.url
          : new URL(requestInput.url, "https://waka.test").toString();

      this.headers = new Headers(init.headers ?? requestInput.headers);
      this.method = init.method ?? requestInput.method ?? "GET";
      this.mode = init.mode ?? requestInput.mode;
      this.url = resolvedUrl;
    }
  }

  const context = {
    AbortController,
    Headers,
    Request: MockRequest,
    Response,
    URL,
    caches: {
      async delete() {
        return true;
      },
      async keys() {
        return [];
      },
      async match() {
        return undefined;
      },
      async open() {
        return {
          addAll() {
            return Promise.resolve();
          },
          put() {
            return Promise.resolve();
          },
        };
      },
    },
    clearTimeout: () => undefined,
    fetch: async () => new Response("ok"),
    self: {
      clients: {
        claim() {
          return Promise.resolve();
        },
      },
      location: {
        origin: "https://waka.test",
      },
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener);
      },
      skipWaiting() {
        skipWaitingCalls += 1;
        return Promise.resolve();
      },
    },
    setTimeout: () => 1,
  };

  vm.runInNewContext(source, context);

  const messageListener = listeners.get("message");

  assert.ok(messageListener, "Service worker should register a message listener.");

  let waitUntilPromise = Promise.resolve();
  messageListener({
    data: options.message,
    waitUntil(promise: Promise<unknown>) {
      waitUntilPromise = Promise.resolve(promise);
    },
  });
  await waitUntilPromise;

  return {
    skipWaitingCalls,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
