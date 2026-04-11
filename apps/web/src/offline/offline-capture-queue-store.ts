export const OFFLINE_CAPTURE_QUEUE_DATABASE_NAME =
  "waka-offline-capture-queue";
export const OFFLINE_CAPTURE_QUEUE_OBJECT_STORE_NAME = "captures";
export const OFFLINE_CAPTURE_QUEUE_ORDER_OBJECT_STORE_NAME = "capture-order";
export const OFFLINE_CAPTURE_QUEUE_DATABASE_VERSION = 2;
export const OFFLINE_CAPTURE_QUEUE_UNSUPPORTED_ERROR =
  "IndexedDB is not available in this environment.";
export const OFFLINE_CAPTURE_QUEUE_RAW_CONTENT_REQUIRED_ERROR =
  "Offline capture queue requires rawContent to contain at least 1 character.";
export const OFFLINE_CAPTURE_QUEUE_SOURCE_TYPE_INVALID_ERROR =
  "Offline capture queue sourceType must be one of the supported inspiration source types.";

export const OFFLINE_CAPTURE_QUEUE_SOURCE_TYPES = [
  "CLI_CONVERSATION",
  "VOICE_NOTE",
  "TEXT_NOTE",
  "URL_IMPORT",
  "PHOTO",
  "AI_CONVERSATION",
] as const;

export const OFFLINE_CAPTURE_QUEUE_PENDING_STATUSES = [
  "queued",
  "syncing",
  "failed",
] as const;

export type OfflineCaptureSourceType =
  (typeof OFFLINE_CAPTURE_QUEUE_SOURCE_TYPES)[number];
export type OfflineCaptureQueuePendingStatus =
  (typeof OFFLINE_CAPTURE_QUEUE_PENDING_STATUSES)[number];
export type OfflineCaptureQueueStatus =
  | OfflineCaptureQueuePendingStatus
  | "synced";

export interface OfflineCaptureQueuePayload {
  audioDurationSeconds?: number;
  audioMimeType?: string;
  audioSizeBytes?: number;
  audioStorageKey?: string;
  audioStorageUrl?: string;
  clusterId?: string;
  mediaUrl?: string;
  parentId?: string;
  rawContent: string;
  sourceParentId?: string;
  sourceMeta?: Record<string, unknown>;
  sourceType: OfflineCaptureSourceType;
  sourceUrl?: string;
  title?: string;
  transcript?: string;
}

export interface OfflineCaptureRetryMetadata {
  attemptCount: number;
  lastAttemptAt?: string;
  lastError?: string;
  nextRetryAt?: string;
}

export interface OfflineCaptureReplayAttempt {
  attemptCount: number;
  lastAttemptAt?: string;
}

export interface OfflineCaptureQueueRecord {
  createdAt: string;
  id: string;
  payload: OfflineCaptureQueuePayload;
  retry: OfflineCaptureRetryMetadata;
  status: OfflineCaptureQueueStatus;
  syncedAt?: string;
  updatedAt: string;
}

export interface SaveOfflineCaptureInput {
  id?: string;
  payload: OfflineCaptureQueuePayload;
}

export interface MarkOfflineCaptureFailureInput {
  errorMessage: string;
  nextRetryAt?: string;
}

interface IndexedDbFactoryLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

interface OfflineCaptureQueueOrderRecord {
  captureId: string;
  order: number;
}

export interface CreateOfflineCaptureQueueStoreOptions {
  databaseName?: string;
  generateId?: () => string;
  indexedDb?: IndexedDbFactoryLike;
  now?: () => Date;
  objectStoreName?: string;
}

export interface OfflineCaptureQueueStore {
  deleteCapture(id: string): Promise<void>;
  getCapture(id: string): Promise<OfflineCaptureQueueRecord | null>;
  listCaptures(): Promise<readonly OfflineCaptureQueueRecord[]>;
  listPendingCaptures(): Promise<readonly OfflineCaptureQueueRecord[]>;
  markCaptureFailed(
    id: string,
    input: MarkOfflineCaptureFailureInput,
    expectedReplayAttempt?: OfflineCaptureReplayAttempt,
  ): Promise<OfflineCaptureQueueRecord | null>;
  markCaptureQueued(
    id: string,
    nextRetryAt?: string,
  ): Promise<OfflineCaptureQueueRecord | null>;
  markCaptureSynced(
    id: string,
    syncedAt?: string,
    expectedReplayAttempt?: OfflineCaptureReplayAttempt,
  ): Promise<OfflineCaptureQueueRecord | null>;
  markCaptureSyncing(
    id: string,
    attemptedAt?: string,
  ): Promise<OfflineCaptureQueueRecord | null>;
  saveCapture(
    input: SaveOfflineCaptureInput,
  ): Promise<OfflineCaptureQueueRecord>;
}

function waitForRequest<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
  });
}

function isOfflineCaptureSourceType(
  value: string,
): value is OfflineCaptureSourceType {
  return OFFLINE_CAPTURE_QUEUE_SOURCE_TYPES.includes(
    value as OfflineCaptureSourceType,
  );
}

function assertOfflineCapturePayload(
  payload: OfflineCaptureQueuePayload,
): void {
  if (payload.rawContent.length < 1) {
    throw new TypeError(OFFLINE_CAPTURE_QUEUE_RAW_CONTENT_REQUIRED_ERROR);
  }

  if (!isOfflineCaptureSourceType(payload.sourceType)) {
    throw new TypeError(OFFLINE_CAPTURE_QUEUE_SOURCE_TYPE_INVALID_ERROR);
  }
}

function createEmptyRetryMetadata(): OfflineCaptureRetryMetadata {
  return {
    attemptCount: 0,
  };
}

function sortLegacyOfflineCaptureRecords(
  records: readonly OfflineCaptureQueueRecord[],
): OfflineCaptureQueueRecord[] {
  return [...records].sort((left, right) => {
    const createdAtComparison = left.createdAt.localeCompare(right.createdAt);

    if (createdAtComparison !== 0) {
      return createdAtComparison;
    }

    return left.id.localeCompare(right.id);
  });
}

function sortOfflineCaptureOrderRecords(
  records: readonly OfflineCaptureQueueOrderRecord[],
): OfflineCaptureQueueOrderRecord[] {
  return [...records].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.captureId.localeCompare(right.captureId);
  });
}

function isPendingOfflineCaptureStatus(
  status: OfflineCaptureQueueStatus,
): status is OfflineCaptureQueuePendingStatus {
  return (
    status === "queued" || status === "syncing" || status === "failed"
  );
}

function matchesOfflineCaptureReplayAttempt(
  capture: OfflineCaptureQueueRecord,
  expectedReplayAttempt?: OfflineCaptureReplayAttempt,
): boolean {
  if (expectedReplayAttempt === undefined) {
    return true;
  }

  return (
    capture.status === "syncing" &&
    capture.retry.attemptCount === expectedReplayAttempt.attemptCount &&
    capture.retry.lastAttemptAt === expectedReplayAttempt.lastAttemptAt
  );
}

export function createOfflineCaptureQueueStore(
  options: CreateOfflineCaptureQueueStoreOptions = {},
): OfflineCaptureQueueStore {
  const databaseName =
    options.databaseName ?? OFFLINE_CAPTURE_QUEUE_DATABASE_NAME;
  const objectStoreName =
    options.objectStoreName ?? OFFLINE_CAPTURE_QUEUE_OBJECT_STORE_NAME;
  const orderObjectStoreName = OFFLINE_CAPTURE_QUEUE_ORDER_OBJECT_STORE_NAME;
  const indexedDb =
    options.indexedDb ??
    (typeof indexedDB === "undefined" ? undefined : indexedDB);
  const now = options.now ?? (() => new Date());
  const generateId =
    options.generateId ?? (() => globalThis.crypto.randomUUID());

  if (indexedDb === undefined) {
    throw new Error(OFFLINE_CAPTURE_QUEUE_UNSUPPORTED_ERROR);
  }

  const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(
      databaseName,
      OFFLINE_CAPTURE_QUEUE_DATABASE_VERSION,
    );

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB database open failed."));
    };
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(objectStoreName)) {
        database.createObjectStore(objectStoreName, {
          keyPath: "id",
        });
      }

      if (!database.objectStoreNames.contains(orderObjectStoreName)) {
        database.createObjectStore(orderObjectStoreName, {
          keyPath: "captureId",
        });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });

  async function getCapture(id: string): Promise<OfflineCaptureQueueRecord | null> {
    const database = await databasePromise;
    const request = database
      .transaction(objectStoreName, "readonly")
      .objectStore(objectStoreName)
      .get(id);

    const result = await waitForRequest(request);

    return result == null ? null : (result as OfflineCaptureQueueRecord);
  }

  async function writeCapture(record: OfflineCaptureQueueRecord): Promise<void> {
    const database = await databasePromise;
    const request = database
      .transaction(objectStoreName, "readwrite")
      .objectStore(objectStoreName)
      .put(record);

    await waitForRequest(request);
  }

  async function getCaptureOrderRecord(
    captureId: string,
  ): Promise<OfflineCaptureQueueOrderRecord | null> {
    const database = await databasePromise;

    if (!database.objectStoreNames.contains(orderObjectStoreName)) {
      return null;
    }

    const request = database
      .transaction(orderObjectStoreName, "readonly")
      .objectStore(orderObjectStoreName)
      .get(captureId);
    const result = await waitForRequest(request);

    if (
      result === null ||
      result === undefined ||
      typeof result !== "object" ||
      typeof (result as OfflineCaptureQueueOrderRecord).captureId !== "string" ||
      typeof (result as OfflineCaptureQueueOrderRecord).order !== "number"
    ) {
      return null;
    }

    return result as OfflineCaptureQueueOrderRecord;
  }

  async function listCaptureOrderRecords(): Promise<
    readonly OfflineCaptureQueueOrderRecord[]
  > {
    const database = await databasePromise;

    if (!database.objectStoreNames.contains(orderObjectStoreName)) {
      return [];
    }

    const request = database
      .transaction(orderObjectStoreName, "readonly")
      .objectStore(orderObjectStoreName)
      .getAll();
    const records = await waitForRequest(request);

    return sortOfflineCaptureOrderRecords(
      (records as unknown[]).filter((record): record is OfflineCaptureQueueOrderRecord => {
        return (
          typeof record === "object" &&
          record !== null &&
          typeof (record as OfflineCaptureQueueOrderRecord).captureId === "string" &&
          typeof (record as OfflineCaptureQueueOrderRecord).order === "number"
        );
      }),
    );
  }

  async function getNextCaptureOrder(): Promise<number> {
    const orderRecords = await listCaptureOrderRecords();

    return (
      orderRecords.reduce((highestOrder, record) => {
        return Math.max(highestOrder, record.order);
      }, -1) + 1
    );
  }

  async function ensureCaptureOrderRecord(captureId: string): Promise<void> {
    const existingOrderRecord = await getCaptureOrderRecord(captureId);

    if (existingOrderRecord !== null) {
      return;
    }

    const database = await databasePromise;

    if (!database.objectStoreNames.contains(orderObjectStoreName)) {
      return;
    }

    const request = database
      .transaction(orderObjectStoreName, "readwrite")
      .objectStore(orderObjectStoreName)
      .put({
        captureId,
        order: await getNextCaptureOrder(),
      } satisfies OfflineCaptureQueueOrderRecord);

    await waitForRequest(request);
  }

  async function deleteCaptureOrderRecord(captureId: string): Promise<void> {
    const database = await databasePromise;

    if (!database.objectStoreNames.contains(orderObjectStoreName)) {
      return;
    }

    const request = database
      .transaction(orderObjectStoreName, "readwrite")
      .objectStore(orderObjectStoreName)
      .delete(captureId);

    await waitForRequest(request);
  }

  async function deleteCapture(id: string): Promise<void> {
    const database = await databasePromise;
    const request = database
      .transaction(objectStoreName, "readwrite")
      .objectStore(objectStoreName)
      .delete(id);

    await waitForRequest(request);
    await deleteCaptureOrderRecord(id);
  }

  async function listCaptures(): Promise<readonly OfflineCaptureQueueRecord[]> {
    const database = await databasePromise;
    const request = database
      .transaction(objectStoreName, "readonly")
      .objectStore(objectStoreName)
      .getAll();
    const records = await waitForRequest(request);
    const capturesById = new Map(
      (records as OfflineCaptureQueueRecord[]).map((record) => [record.id, record]),
    );
    const orderedCaptures: OfflineCaptureQueueRecord[] = [];

    for (const orderRecord of await listCaptureOrderRecords()) {
      const capture = capturesById.get(orderRecord.captureId);

      if (capture === undefined) {
        continue;
      }

      orderedCaptures.push(capture);
      capturesById.delete(orderRecord.captureId);
    }

    return [
      ...orderedCaptures,
      ...sortLegacyOfflineCaptureRecords([...capturesById.values()]),
    ];
  }

  async function updateCapture(
    id: string,
    transform: (
      currentCapture: OfflineCaptureQueueRecord,
    ) => OfflineCaptureQueueRecord | null,
  ): Promise<OfflineCaptureQueueRecord | null> {
    const currentCapture = await getCapture(id);

    if (currentCapture === null) {
      return null;
    }

    const nextCapture = transform(currentCapture);

    if (nextCapture === null) {
      return null;
    }

    await writeCapture(nextCapture);

    return nextCapture;
  }

  return {
    async saveCapture(input) {
      assertOfflineCapturePayload(input.payload);

      const timestamp = now().toISOString();
      const existingCapture =
        input.id === undefined ? null : await getCapture(input.id);
      const id = input.id ?? generateId();
      const nextCapture: OfflineCaptureQueueRecord = {
        createdAt: existingCapture?.createdAt ?? timestamp,
        id,
        payload: input.payload,
        retry: createEmptyRetryMetadata(),
        status: "queued",
        updatedAt: timestamp,
      };

      await writeCapture(nextCapture);
      await ensureCaptureOrderRecord(id);

      return nextCapture;
    },
    getCapture,
    listCaptures,
    async listPendingCaptures() {
      const captures = await listCaptures();

      return captures.filter((capture) =>
        isPendingOfflineCaptureStatus(capture.status),
      );
    },
    async markCaptureSyncing(id, attemptedAt = now().toISOString()) {
      return updateCapture(id, (currentCapture) => ({
        ...currentCapture,
        retry: {
          ...currentCapture.retry,
          attemptCount: currentCapture.retry.attemptCount + 1,
          lastAttemptAt: attemptedAt,
        },
        status: "syncing",
        syncedAt: undefined,
        updatedAt: attemptedAt,
      }));
    },
    async markCaptureFailed(id, input, expectedReplayAttempt) {
      const failureTimestamp = now().toISOString();

      return updateCapture(id, (currentCapture) => {
        if (
          !matchesOfflineCaptureReplayAttempt(
            currentCapture,
            expectedReplayAttempt,
          )
        ) {
          return null;
        }

        const wasAlreadySyncing = currentCapture.status === "syncing";
        const attemptCount = wasAlreadySyncing
          ? currentCapture.retry.attemptCount
          : currentCapture.retry.attemptCount + 1;

        return {
          ...currentCapture,
          retry: {
            ...currentCapture.retry,
            attemptCount,
            lastAttemptAt:
              currentCapture.retry.lastAttemptAt ?? failureTimestamp,
            lastError: input.errorMessage,
            nextRetryAt: input.nextRetryAt,
          },
          status: "failed",
          syncedAt: undefined,
          updatedAt: failureTimestamp,
        };
      });
    },
    async markCaptureQueued(id, nextRetryAt) {
      const queuedAt = now().toISOString();

      return updateCapture(id, (currentCapture) => ({
        ...currentCapture,
        retry: {
          ...currentCapture.retry,
          nextRetryAt,
        },
        status: "queued",
        syncedAt: undefined,
        updatedAt: queuedAt,
      }));
    },
    async markCaptureSynced(
      id,
      syncedAt = now().toISOString(),
      expectedReplayAttempt,
    ) {
      return updateCapture(id, (currentCapture) => {
        if (
          !matchesOfflineCaptureReplayAttempt(
            currentCapture,
            expectedReplayAttempt,
          )
        ) {
          return null;
        }

        return {
          ...currentCapture,
          retry: {
            ...currentCapture.retry,
            lastError: undefined,
            nextRetryAt: undefined,
          },
          status: "synced",
          syncedAt,
          updatedAt: syncedAt,
        };
      });
    },
    deleteCapture,
  };
}
