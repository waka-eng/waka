import assert from "node:assert/strict";
import test from "node:test";

import { replayOfflineCaptureQueue } from "../apps/web/src/offline/offline-capture-replay-worker.ts";
import type {
  MarkOfflineCaptureFailureInput,
  OfflineCaptureReplayAttempt,
  OfflineCaptureQueueRecord,
  OfflineCaptureQueueStore,
} from "../apps/web/src/offline/offline-capture-queue-store.ts";

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

function createQueuedCaptureRecord(id: string): OfflineCaptureQueueRecord {
  return {
    createdAt: "2026-04-11T00:00:00.000Z",
    id,
    payload: {
      rawContent: `Queued capture ${id}`,
      sourceType: "TEXT_NOTE",
    },
    retry: {
      attemptCount: 0,
    },
    status: "queued",
    updatedAt: "2026-04-11T00:00:00.000Z",
  };
}

function isPendingCaptureStatus(status: OfflineCaptureQueueRecord["status"]): boolean {
  return status === "queued" || status === "syncing" || status === "failed";
}

function matchesReplayAttempt(
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

function createReplayQueueStoreHarness(
  pendingCaptures: readonly OfflineCaptureQueueRecord[],
): {
  failedCalls: Array<{
    id: string;
    input: MarkOfflineCaptureFailureInput;
  }>;
  operations: string[];
  queueStore: OfflineCaptureQueueStore;
} {
  const captureRecords = new Map(
    pendingCaptures.map((capture) => [capture.id, capture]),
  );
  const captureOrder = pendingCaptures.map((capture) => capture.id);
  const operations: string[] = [];
  const failedCalls: Array<{
    id: string;
    input: MarkOfflineCaptureFailureInput;
  }> = [];

  function listOrderedCaptures(): OfflineCaptureQueueRecord[] {
    return captureOrder.flatMap((captureId) => {
      const capture = captureRecords.get(captureId);

      return capture === undefined ? [] : [capture];
    });
  }

  const queueStore: OfflineCaptureQueueStore = {
    async deleteCapture(id) {
      captureRecords.delete(id);
      const captureOrderIndex = captureOrder.indexOf(id);

      if (captureOrderIndex >= 0) {
        captureOrder.splice(captureOrderIndex, 1);
      }
    },
    async getCapture(id) {
      return captureRecords.get(id) ?? null;
    },
    async listCaptures() {
      return listOrderedCaptures();
    },
    async listPendingCaptures() {
      operations.push("listPendingCaptures");

      return listOrderedCaptures().filter((capture) =>
        isPendingCaptureStatus(capture.status),
      );
    },
    async markCaptureFailed(id, input, expectedReplayAttempt) {
      operations.push(`markCaptureFailed:${id}`);
      failedCalls.push({ id, input });
      const capture = captureRecords.get(id);

      if (capture === undefined) {
        return null;
      }

      if (!matchesReplayAttempt(capture, expectedReplayAttempt)) {
        return null;
      }

      const failedCapture: OfflineCaptureQueueRecord = {
        ...capture,
        retry: {
          ...capture.retry,
          lastError: input.errorMessage,
          nextRetryAt: input.nextRetryAt,
        },
        status: "failed",
      };

      captureRecords.set(id, failedCapture);

      return failedCapture;
    },
    async markCaptureQueued(id) {
      const capture = captureRecords.get(id);

      if (capture === undefined) {
        return null;
      }

      const queuedCapture: OfflineCaptureQueueRecord = {
        ...capture,
        status: "queued",
      };

      captureRecords.set(id, queuedCapture);

      return queuedCapture;
    },
    async markCaptureSynced(id, _syncedAt, expectedReplayAttempt) {
      operations.push(`markCaptureSynced:${id}`);
      const capture = captureRecords.get(id);

      if (capture === undefined) {
        return null;
      }

      if (!matchesReplayAttempt(capture, expectedReplayAttempt)) {
        return null;
      }

      const syncedCapture: OfflineCaptureQueueRecord = {
        ...capture,
        status: "synced",
        syncedAt: "2026-04-11T00:00:05.000Z",
      };

      captureRecords.set(id, syncedCapture);

      return syncedCapture;
    },
    async markCaptureSyncing(id) {
      operations.push(`markCaptureSyncing:${id}`);
      const capture = captureRecords.get(id);

      if (capture === undefined) {
        return null;
      }

      const syncingCapture: OfflineCaptureQueueRecord = {
        ...capture,
        retry: {
          ...capture.retry,
          attemptCount: capture.retry.attemptCount + 1,
          lastAttemptAt: "2026-04-11T00:00:01.000Z",
        },
        status: "syncing",
      };

      captureRecords.set(id, syncingCapture);

      return syncingCapture;
    },
    async saveCapture(input) {
      const id = input.id ?? `generated-capture-${captureOrder.length + 1}`;
      const existingCapture = captureRecords.get(id);
      const queuedCapture: OfflineCaptureQueueRecord = {
        createdAt:
          existingCapture?.createdAt ?? "2026-04-11T00:00:00.000Z",
        id,
        payload: input.payload,
        retry: {
          attemptCount: 0,
        },
        status: "queued",
        updatedAt: "2026-04-11T00:00:02.000Z",
      };

      if (existingCapture === undefined) {
        captureOrder.push(id);
      }

      captureRecords.set(id, queuedCapture);

      return queuedCapture;
    },
  };

  return {
    failedCalls,
    operations,
    queueStore,
  };
}

test("replayOfflineCaptureQueue replays pending captures sequentially in the queue order", async () => {
  const { operations, queueStore } = createReplayQueueStoreHarness([
    createQueuedCaptureRecord("queued-first"),
    createQueuedCaptureRecord("queued-second"),
  ]);
  const firstReplay = createDeferredPromise();
  const startedCaptures: string[] = [];

  const replayPromise = replayOfflineCaptureQueue({
    queueStore,
    replayCapture: async (capture) => {
      startedCaptures.push(capture.id);

      if (capture.id === "queued-first") {
        await firstReplay.promise;
      }

      return {
        persistedCaptureId: `persisted-${capture.id}`,
      };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(startedCaptures, ["queued-first"]);
  assert.deepEqual(operations, [
    "listPendingCaptures",
    "markCaptureSyncing:queued-first",
  ]);

  firstReplay.resolve();

  const result = await replayPromise;

  assert.deepEqual(startedCaptures, ["queued-first", "queued-second"]);
  assert.deepEqual(operations, [
    "listPendingCaptures",
    "markCaptureSyncing:queued-first",
    "markCaptureSynced:queued-first",
    "markCaptureSyncing:queued-second",
    "markCaptureSynced:queued-second",
  ]);
  assert.deepEqual(result.synced, [
    {
      localCaptureId: "queued-first",
      result: {
        persistedCaptureId: "persisted-queued-first",
      },
    },
    {
      localCaptureId: "queued-second",
      result: {
        persistedCaptureId: "persisted-queued-second",
      },
    },
  ]);
  assert.deepEqual(result.failures, []);
});

test("replayOfflineCaptureQueue marks failed captures and continues with later queued work", async () => {
  const { failedCalls, operations, queueStore } = createReplayQueueStoreHarness([
    createQueuedCaptureRecord("queued-first"),
    createQueuedCaptureRecord("queued-second"),
  ]);

  const result = await replayOfflineCaptureQueue({
    queueStore,
    replayCapture: async (capture) => {
      if (capture.id === "queued-first") {
        throw new Error("Temporary upstream failure");
      }

      return {
        persistedCaptureId: "persisted-queued-second",
      };
    },
  });

  assert.deepEqual(operations, [
    "listPendingCaptures",
    "markCaptureSyncing:queued-first",
    "markCaptureFailed:queued-first",
    "markCaptureSyncing:queued-second",
    "markCaptureSynced:queued-second",
  ]);
  assert.deepEqual(failedCalls, [
    {
      id: "queued-first",
      input: {
        errorMessage: "Temporary upstream failure",
      },
    },
  ]);
  assert.deepEqual(result.failures, [
    {
      error: new Error("Temporary upstream failure"),
      localCaptureId: "queued-first",
    },
  ]);
  assert.deepEqual(result.synced, [
    {
      localCaptureId: "queued-second",
      result: {
        persistedCaptureId: "persisted-queued-second",
      },
    },
  ]);
});

test("replayOfflineCaptureQueue does not settle a newer queued rewrite when an older replay attempt succeeds", async () => {
  const { queueStore } = createReplayQueueStoreHarness([
    createQueuedCaptureRecord("queued-first"),
  ]);

  const result = await replayOfflineCaptureQueue({
    queueStore,
    replayCapture: async (capture) => {
      await queueStore.saveCapture({
        id: capture.id,
        payload: {
          rawContent: "A newer local rewrite should stay queued",
          sourceType: "TEXT_NOTE",
        },
      });

      return {
        persistedCaptureId: "persisted-stale-attempt",
      };
    },
  });

  assert.deepEqual(result.synced, []);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(await queueStore.listPendingCaptures(), [
    {
      createdAt: "2026-04-11T00:00:00.000Z",
      id: "queued-first",
      payload: {
        rawContent: "A newer local rewrite should stay queued",
        sourceType: "TEXT_NOTE",
      },
      retry: {
        attemptCount: 0,
      },
      status: "queued",
      updatedAt: "2026-04-11T00:00:02.000Z",
    },
  ]);
});

test("replayOfflineCaptureQueue keeps later retries in order after mixed success and failure outcomes", async () => {
  const { queueStore } = createReplayQueueStoreHarness([
    createQueuedCaptureRecord("queued-first"),
    createQueuedCaptureRecord("queued-second"),
    createQueuedCaptureRecord("queued-third"),
  ]);

  const firstReplayResult = await replayOfflineCaptureQueue({
    queueStore,
    replayCapture: async (capture) => {
      if (capture.id === "queued-second") {
        throw new Error("Temporary upstream failure");
      }

      return {
        persistedCaptureId: `persisted-${capture.id}`,
      };
    },
  });

  assert.deepEqual(
    firstReplayResult.synced.map((capture) => capture.localCaptureId),
    ["queued-first", "queued-third"],
  );
  assert.deepEqual(
    firstReplayResult.failures.map((capture) => capture.localCaptureId),
    ["queued-second"],
  );
  assert.deepEqual(
    (await queueStore.listPendingCaptures()).map((capture) => capture.id),
    ["queued-second"],
  );

  const secondReplayResult = await replayOfflineCaptureQueue({
    queueStore,
    replayCapture: async (capture) => ({
      persistedCaptureId: `persisted-${capture.id}-retry`,
    }),
  });

  assert.deepEqual(secondReplayResult.failures, []);
  assert.deepEqual(secondReplayResult.synced, [
    {
      localCaptureId: "queued-second",
      result: {
        persistedCaptureId: "persisted-queued-second-retry",
      },
    },
  ]);
  assert.deepEqual(await queueStore.listPendingCaptures(), []);
});
