import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfflineCaptureQueueStore,
  OFFLINE_CAPTURE_QUEUE_RAW_CONTENT_REQUIRED_ERROR,
  type OfflineCaptureQueuePayload,
} from "../apps/web/src/offline/offline-capture-queue-store.ts";

interface FakeObjectStoreState {
  keyPath: string;
  records: Map<IDBValidKey, unknown>;
}

interface FakeDatabaseState {
  stores: Map<string, FakeObjectStoreState>;
  version: number;
}

function cloneValue<TValue>(value: TValue): TValue {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

class FakeRequest<TResult> {
  error: DOMException | null = null;
  onsuccess: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  result!: TResult;
}

class FakeOpenDatabaseRequest extends FakeRequest<IDBDatabase> {
  onupgradeneeded: ((event: IDBVersionChangeEvent) => unknown) | null = null;
}

class FakeObjectStoreNames {
  private readonly state: FakeDatabaseState;

  constructor(state: FakeDatabaseState) {
    this.state = state;
  }

  contains(name: string): boolean {
    return this.state.stores.has(name);
  }
}

class FakeObjectStore {
  private readonly state: FakeObjectStoreState;

  constructor(state: FakeObjectStoreState) {
    this.state = state;
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    const request = new FakeRequest<undefined>();

    queueMicrotask(() => {
      this.state.records.delete(key);
      request.result = undefined;
      request.onsuccess?.({} as Event);
    });

    return request as unknown as IDBRequest<undefined>;
  }

  get(key: IDBValidKey): IDBRequest<unknown> {
    const request = new FakeRequest<unknown>();

    queueMicrotask(() => {
      request.result = cloneValue(this.state.records.get(key));
      request.onsuccess?.({} as Event);
    });

    return request as unknown as IDBRequest<unknown>;
  }

  getAll(): IDBRequest<unknown[]> {
    const request = new FakeRequest<unknown[]>();

    queueMicrotask(() => {
      request.result = [...this.state.records.values()].map((value) =>
        cloneValue(value),
      );
      request.onsuccess?.({} as Event);
    });

    return request as unknown as IDBRequest<unknown[]>;
  }

  put(value: unknown): IDBRequest<IDBValidKey> {
    const request = new FakeRequest<IDBValidKey>();

    queueMicrotask(() => {
      const key = (value as Record<string, unknown>)[this.state.keyPath];

      if (
        typeof key !== "string" &&
        typeof key !== "number" &&
        typeof key !== "bigint" &&
        !(key instanceof Date) &&
        !(key instanceof ArrayBuffer) &&
        !Array.isArray(key)
      ) {
        throw new TypeError("IndexedDB keyPath value is missing.");
      }

      this.state.records.set(key as IDBValidKey, cloneValue(value));
      request.result = key as IDBValidKey;
      request.onsuccess?.({} as Event);
    });

    return request as unknown as IDBRequest<IDBValidKey>;
  }
}

class FakeTransaction {
  private readonly state: FakeDatabaseState;

  constructor(state: FakeDatabaseState) {
    this.state = state;
  }

  objectStore(name: string): IDBObjectStore {
    const objectStoreState = this.state.stores.get(name);

    if (objectStoreState === undefined) {
      throw new Error(`IndexedDB object store ${name} is missing.`);
    }

    return new FakeObjectStore(objectStoreState) as unknown as IDBObjectStore;
  }
}

class FakeDatabase {
  readonly objectStoreNames: FakeObjectStoreNames;
  readonly name: string;
  private readonly state: FakeDatabaseState;

  constructor(name: string, state: FakeDatabaseState) {
    this.name = name;
    this.state = state;
    this.objectStoreNames = new FakeObjectStoreNames(state);
  }

  close(): void {}

  createObjectStore(
    name: string,
    options?: IDBObjectStoreParameters,
  ): IDBObjectStore {
    const keyPath =
      typeof options?.keyPath === "string" ? options.keyPath : "id";
    const objectStoreState: FakeObjectStoreState = {
      keyPath,
      records: new Map(),
    };

    this.state.stores.set(name, objectStoreState);

    return new FakeObjectStore(objectStoreState) as unknown as IDBObjectStore;
  }

  transaction(
    storeNames: string | string[],
    _mode?: IDBTransactionMode,
  ): IDBTransaction {
    const resolvedStoreName = Array.isArray(storeNames)
      ? storeNames[0]
      : storeNames;

    if (typeof resolvedStoreName !== "string") {
      throw new TypeError("A string object store name is required.");
    }

    return new FakeTransaction(this.state) as unknown as IDBTransaction;
  }
}

class FakeIndexedDbFactory {
  private readonly databases = new Map<string, FakeDatabaseState>();

  open(name: string, version = 1): IDBOpenDBRequest {
    const request = new FakeOpenDatabaseRequest();

    queueMicrotask(() => {
      const existingState = this.databases.get(name);
      const needsUpgrade = existingState === undefined || version > existingState.version;
      const state =
        existingState ??
        ({
          stores: new Map(),
          version,
        } satisfies FakeDatabaseState);

      state.version = Math.max(state.version, version);
      this.databases.set(name, state);

      request.result = new FakeDatabase(name, state) as unknown as IDBDatabase;

      if (needsUpgrade) {
        request.onupgradeneeded?.({} as IDBVersionChangeEvent);
      }

      request.onsuccess?.({} as Event);
    });

    return request as unknown as IDBOpenDBRequest;
  }
}

function createDeterministicClock(
  timestamps: readonly string[],
): () => Date {
  let index = 0;

  return () => {
    const resolvedIndex =
      index < timestamps.length ? index : timestamps.length - 1;
    const timestamp = timestamps[resolvedIndex];

    index += 1;

    return new Date(timestamp);
  };
}

function createPayload(
  overrides: Partial<OfflineCaptureQueuePayload> = {},
): OfflineCaptureQueuePayload {
  return {
    rawContent: "Queue this capture locally.",
    sourceType: "TEXT_NOTE",
    ...overrides,
  };
}

function createStoreHarness(timestamps: readonly string[]) {
  return createOfflineCaptureQueueStore({
    databaseName: `waka-test-${timestamps[0]}`,
    generateId: () => "generated-capture-id",
    indexedDb: new FakeIndexedDbFactory(),
    now: createDeterministicClock(timestamps),
  });
}

test("saveCapture persists an unsent capture with queued status and empty retry metadata", async () => {
  const store = createStoreHarness(["2026-04-11T00:00:00.000Z"]);
  const savedCapture = await store.saveCapture({
    id: "capture-1",
    payload: createPayload(),
  });

  assert.deepEqual(savedCapture, {
    createdAt: "2026-04-11T00:00:00.000Z",
    id: "capture-1",
    payload: createPayload(),
    retry: {
      attemptCount: 0,
    },
    status: "queued",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });
  assert.deepEqual(await store.getCapture("capture-1"), savedCapture);
  assert.deepEqual(await store.listPendingCaptures(), [savedCapture]);
});

test("saveCapture applies last-write-wins semantics for an existing local capture id", async () => {
  const store = createStoreHarness([
    "2026-04-11T00:00:00.000Z",
    "2026-04-11T00:02:00.000Z",
    "2026-04-11T00:05:00.000Z",
  ]);

  await store.saveCapture({
    id: "capture-1",
    payload: createPayload({
      rawContent: "Original draft",
    }),
  });
  await store.markCaptureSyncing("capture-1", "2026-04-11T00:01:00.000Z");
  await store.markCaptureFailed("capture-1", {
    errorMessage: "Network unavailable",
    nextRetryAt: "2026-04-11T00:03:00.000Z",
  });

  const overwrittenCapture = await store.saveCapture({
    id: "capture-1",
    payload: createPayload({
      rawContent: "Edited draft should win",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://example.com/idea",
    }),
  });

  assert.deepEqual(overwrittenCapture, {
    createdAt: "2026-04-11T00:00:00.000Z",
    id: "capture-1",
    payload: createPayload({
      rawContent: "Edited draft should win",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://example.com/idea",
    }),
    retry: {
      attemptCount: 0,
    },
    status: "queued",
    updatedAt: "2026-04-11T00:05:00.000Z",
  });
});

test("status transitions keep retry metadata needed for reconnect retries", async () => {
  const store = createStoreHarness([
    "2026-04-11T10:00:00.000Z",
    "2026-04-11T10:00:02.000Z",
    "2026-04-11T10:00:05.000Z",
  ]);

  await store.saveCapture({
    id: "capture-1",
    payload: createPayload(),
  });

  const syncingCapture = await store.markCaptureSyncing(
    "capture-1",
    "2026-04-11T10:00:01.000Z",
  );
  const failedCapture = await store.markCaptureFailed("capture-1", {
    errorMessage: "Gateway timeout",
    nextRetryAt: "2026-04-11T10:01:00.000Z",
  });
  const queuedForRetryCapture = await store.markCaptureQueued(
    "capture-1",
    "2026-04-11T10:02:00.000Z",
  );

  assert.equal(syncingCapture?.status, "syncing");
  assert.deepEqual(syncingCapture?.retry, {
    attemptCount: 1,
    lastAttemptAt: "2026-04-11T10:00:01.000Z",
  });
  assert.equal(failedCapture?.status, "failed");
  assert.deepEqual(failedCapture?.retry, {
    attemptCount: 1,
    lastAttemptAt: "2026-04-11T10:00:01.000Z",
    lastError: "Gateway timeout",
    nextRetryAt: "2026-04-11T10:01:00.000Z",
  });
  assert.equal(queuedForRetryCapture?.status, "queued");
  assert.deepEqual(queuedForRetryCapture?.retry, {
    attemptCount: 1,
    lastAttemptAt: "2026-04-11T10:00:01.000Z",
    lastError: "Gateway timeout",
    nextRetryAt: "2026-04-11T10:02:00.000Z",
  });
});

test("markCaptureSynced removes a persisted capture from the pending queue while keeping the audit metadata", async () => {
  const store = createStoreHarness([
    "2026-04-11T12:00:00.000Z",
    "2026-04-11T12:00:10.000Z",
  ]);

  await store.saveCapture({
    id: "capture-1",
    payload: createPayload(),
  });

  const syncedCapture = await store.markCaptureSynced(
    "capture-1",
    "2026-04-11T12:00:05.000Z",
  );

  assert.deepEqual(await store.listPendingCaptures(), []);
  assert.deepEqual(syncedCapture, {
    createdAt: "2026-04-11T12:00:00.000Z",
    id: "capture-1",
    payload: createPayload(),
    retry: {
      attemptCount: 0,
      lastError: undefined,
      nextRetryAt: undefined,
    },
    status: "synced",
    syncedAt: "2026-04-11T12:00:05.000Z",
    updatedAt: "2026-04-11T12:00:05.000Z",
  });
});

test("stale replay settlement does not overwrite a newer queued rewrite for the same local capture id", async () => {
  const store = createStoreHarness([
    "2026-04-11T13:00:00.000Z",
    "2026-04-11T13:00:02.000Z",
  ]);

  await store.saveCapture({
    id: "capture-1",
    payload: createPayload({
      rawContent: "Original draft",
    }),
  });
  await store.markCaptureSyncing(
    "capture-1",
    "2026-04-11T13:00:01.000Z",
  );
  await store.saveCapture({
    id: "capture-1",
    payload: createPayload({
      rawContent: "Newer local rewrite",
    }),
  });

  assert.equal(
    await store.markCaptureSynced(
      "capture-1",
      "2026-04-11T13:00:05.000Z",
      {
        attemptCount: 1,
        lastAttemptAt: "2026-04-11T13:00:01.000Z",
      },
    ),
    null,
  );
  assert.equal(
    await store.markCaptureFailed(
      "capture-1",
      {
        errorMessage: "Stale replay attempt should not win",
      },
      {
        attemptCount: 1,
        lastAttemptAt: "2026-04-11T13:00:01.000Z",
      },
    ),
    null,
  );
  assert.deepEqual(await store.getCapture("capture-1"), {
    createdAt: "2026-04-11T13:00:00.000Z",
    id: "capture-1",
    payload: createPayload({
      rawContent: "Newer local rewrite",
    }),
    retry: {
      attemptCount: 0,
    },
    status: "queued",
    updatedAt: "2026-04-11T13:00:02.000Z",
  });
});

test("saveCapture rejects payloads whose raw content is empty", async () => {
  const store = createStoreHarness(["2026-04-11T14:00:00.000Z"]);

  await assert.rejects(
    () =>
      store.saveCapture({
        payload: createPayload({
          rawContent: "",
        }),
      }),
    new TypeError(OFFLINE_CAPTURE_QUEUE_RAW_CONTENT_REQUIRED_ERROR),
  );
});

test("listPendingCaptures preserves persisted enqueue order after retry status updates", async () => {
  const store = createStoreHarness([
    "2026-04-11T15:00:00.000Z",
    "2026-04-11T15:00:00.000Z",
    "2026-04-11T15:02:00.000Z",
  ]);

  await store.saveCapture({
    id: "capture-z",
    payload: createPayload({
      rawContent: "First persisted capture",
    }),
  });
  await store.saveCapture({
    id: "capture-a",
    payload: createPayload({
      rawContent: "Second persisted capture",
    }),
  });
  await store.markCaptureSyncing(
    "capture-z",
    "2026-04-11T15:01:00.000Z",
  );
  await store.markCaptureFailed("capture-z", {
    errorMessage: "Network unavailable",
  });

  assert.deepEqual(
    (await store.listPendingCaptures()).map((capture) => capture.id),
    ["capture-z", "capture-a"],
  );
});
