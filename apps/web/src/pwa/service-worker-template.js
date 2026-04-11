const WAKA_APP_SHELL_CACHE_PREFIX = "waka-app-shell";
const WAKA_APP_SHELL_CACHE_VERSION = "__WAKA_APP_SHELL_CACHE_VERSION__";
const WAKA_APP_SHELL_CACHE = `${WAKA_APP_SHELL_CACHE_PREFIX}-${WAKA_APP_SHELL_CACHE_VERSION}`;
const WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH =
  __WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH__;
const WAKA_APP_SHELL_NAVIGATION_TIMEOUT_MS = 3000;
const WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE =
  "waka:service-worker:skip-waiting";
const WAKA_APP_SHELL_ROUTE_PATHS = __WAKA_APP_SHELL_ROUTE_PATHS__;
const WAKA_APP_SHELL_PRECACHED_PATHS = __WAKA_APP_SHELL_PRECACHED_PATHS__;
const WAKA_APP_SHELL_ASSET_REQUESTS = WAKA_APP_SHELL_PRECACHED_PATHS.map(
  (assetPath) => new Request(assetPath, { cache: "reload" }),
);

function shouldCacheSuccessfulResponse(response, cacheKey) {
  if (!response.ok) {
    return false;
  }

  if (!response.url) {
    return true;
  }

  const responseUrl = new URL(response.url);

  return (
    responseUrl.origin === self.location.origin && responseUrl.pathname === cacheKey
  );
}

function getNavigationFallbackCacheKey(requestUrl) {
  if (WAKA_APP_SHELL_ROUTE_PATHS.includes(requestUrl.pathname)) {
    return requestUrl.pathname;
  }

  return WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH;
}

function shouldCacheNavigationResponse(response, requestUrl) {
  if (!WAKA_APP_SHELL_ROUTE_PATHS.includes(requestUrl.pathname)) {
    return false;
  }

  return shouldCacheSuccessfulResponse(response, requestUrl.pathname);
}

function isSkipWaitingMessage(message) {
  return (
    message !== null &&
    typeof message === "object" &&
    message.type === WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE
  );
}

async function fetchWithTimeout(request, timeoutMs) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetch(request, {
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function respondToNavigationRequest(request, requestUrl) {
  const navigationFallbackCacheKey = getNavigationFallbackCacheKey(requestUrl);

  try {
    const response = await fetchWithTimeout(
      request,
      WAKA_APP_SHELL_NAVIGATION_TIMEOUT_MS,
    );

    if (shouldCacheNavigationResponse(response, requestUrl)) {
      const responseClone = response.clone();

      void caches
        .open(WAKA_APP_SHELL_CACHE)
        .then((cache) => cache.put(requestUrl.pathname, responseClone))
        .catch(() => undefined);
    }

    return response;
  } catch {
    const cachedResponse =
      (await caches.match(requestUrl.pathname)) ??
      (await caches.match(navigationFallbackCacheKey));

    return cachedResponse ?? Response.error();
  }
}

async function respondWithCacheFirst(request, cacheKey) {
  const cachedResponse = await caches.match(cacheKey);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (shouldCacheSuccessfulResponse(response, cacheKey)) {
    const responseClone = response.clone();

    void caches
      .open(WAKA_APP_SHELL_CACHE)
      .then((cache) => cache.put(cacheKey, responseClone))
      .catch(() => undefined);
  }

  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(WAKA_APP_SHELL_CACHE)
      .then((cache) => cache.addAll(WAKA_APP_SHELL_ASSET_REQUESTS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheKeys) =>
        Promise.all(
          cacheKeys
            .filter(
              (cacheKey) =>
                cacheKey.startsWith(WAKA_APP_SHELL_CACHE_PREFIX) &&
                cacheKey !== WAKA_APP_SHELL_CACHE,
            )
            .map((cacheKey) => caches.delete(cacheKey)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (!isSkipWaitingMessage(event.data)) {
    return;
  }

  event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (
    request.mode === "navigate"
  ) {
    event.respondWith(respondToNavigationRequest(request, requestUrl));

    return;
  }

  if (!WAKA_APP_SHELL_PRECACHED_PATHS.includes(requestUrl.pathname)) {
    return;
  }

  event.respondWith(respondWithCacheFirst(request, requestUrl.pathname));
});
