import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  replayWorkspaceHomeQueuedCaptures,
  type ReplayWorkspaceHomeQueuedCapturesResult,
} from "../apps/web/src/home/text-capture-create.ts";
import type {
  MarkOfflineCaptureFailureInput,
  OfflineCaptureQueueRecord,
  OfflineCaptureQueueStore,
} from "../apps/web/src/offline/offline-capture-queue-store.ts";

const WORKSPACE_CAPTURE_BAR_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-capture-bar.tsx",
);

function createQueuedCaptureRecord(
  id: string,
  overrides: Partial<OfflineCaptureQueueRecord["payload"]> = {},
): OfflineCaptureQueueRecord {
  return {
    createdAt: "2026-04-11T00:00:00.000Z",
    id,
    payload: {
      rawContent: `Queued capture ${id}`,
      sourceType: "TEXT_NOTE",
      ...overrides,
    },
    retry: {
      attemptCount: 0,
    },
    status: "queued",
    updatedAt: "2026-04-11T00:00:00.000Z",
  };
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
  const operations: string[] = [];
  const failedCalls: Array<{
    id: string;
    input: MarkOfflineCaptureFailureInput;
  }> = [];

  const queueStore: OfflineCaptureQueueStore = {
    async deleteCapture(id) {
      captureRecords.delete(id);
    },
    async getCapture(id) {
      return captureRecords.get(id) ?? null;
    },
    async listCaptures() {
      return [...captureRecords.values()];
    },
    async listPendingCaptures() {
      operations.push("listPendingCaptures");
      return pendingCaptures;
    },
    async markCaptureFailed(id, input, _expectedReplayAttempt) {
      operations.push(`markCaptureFailed:${id}`);
      failedCalls.push({ id, input });
      const capture = captureRecords.get(id);

      if (capture === undefined) {
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
    async markCaptureSynced(id, _syncedAt, _expectedReplayAttempt) {
      operations.push(`markCaptureSynced:${id}`);
      const capture = captureRecords.get(id);

      if (capture === undefined) {
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
    async saveCapture() {
      throw new Error("saveCapture is not used in queued replay tests.");
    },
  };

  return {
    failedCalls,
    operations,
    queueStore,
  };
}

test("replayWorkspaceHomeQueuedCaptures posts queued captures and marks successful replays as synced", async () => {
  const { operations, queueStore } = createReplayQueueStoreHarness([
    createQueuedCaptureRecord("queued-url-capture", {
      rawContent: "Review this later",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://example.com/post",
    }),
  ]);
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];

  const result = await replayWorkspaceHomeQueuedCaptures({
    fetchImplementation: async (input, init) => {
      requests.push({ input, init });

      return Response.json({
        id: "insp-replayed",
        processingState: {
          fields: {
            summary: {
              status: "PENDING",
            },
            tags: {
              status: "PENDING",
            },
            title: {
              status: "PROCESSING",
            },
          },
          status: "PROCESSING",
        },
      });
    },
    queueStore,
  });

  assert.deepEqual(operations, [
    "listPendingCaptures",
    "markCaptureSyncing:queued-url-capture",
    "markCaptureSynced:queued-url-capture",
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/inspirations");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    rawContent: "Review this later",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/post",
  });
  assert.deepEqual(result, {
    failures: [],
    synced: [
      {
        localCaptureId: "queued-url-capture",
        persistedCaptureId: "insp-replayed",
        processingState: {
          isTagsPending: true,
          isSummaryPending: true,
          isTitlePending: true,
          status: "PROCESSING",
          summaryStatus: "PENDING",
          tagsStatus: "PENDING",
          titleStatus: "PROCESSING",
        },
      },
    ],
  } satisfies ReplayWorkspaceHomeQueuedCapturesResult);
});

test("replayWorkspaceHomeQueuedCaptures marks failed replays and continues replaying later pending captures", async () => {
  const { failedCalls, operations, queueStore } = createReplayQueueStoreHarness([
    createQueuedCaptureRecord("queued-first"),
    createQueuedCaptureRecord("queued-second"),
  ]);
  const requests: string[] = [];

  const result = await replayWorkspaceHomeQueuedCaptures({
    fetchImplementation: async (input, init) => {
      requests.push(String(input));

      const rawBody = JSON.parse(String(init?.body)) as {
        rawContent: string;
      };

      if (rawBody.rawContent === "Queued capture queued-first") {
        return new Response(null, {
          status: 503,
        });
      }

      return Response.json({
        id: "insp-second",
        processingState: {
          fields: {
            summary: {
              status: "COMPLETED",
            },
            tags: {
              status: "PENDING",
            },
            title: {
              status: "PENDING",
            },
          },
          status: "PROCESSING",
        },
      });
    },
    queueStore,
  });

  assert.deepEqual(requests, ["/api/inspirations", "/api/inspirations"]);
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
        errorMessage: "Capture request failed with status 503",
      },
    },
  ]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.localCaptureId, "queued-first");
  assert.equal(result.synced.length, 1);
  assert.deepEqual(result.synced[0], {
    localCaptureId: "queued-second",
    persistedCaptureId: "insp-second",
    processingState: {
      isTagsPending: true,
      isSummaryPending: false,
      isTitlePending: true,
      status: "PROCESSING",
      summaryStatus: "COMPLETED",
      tagsStatus: "PENDING",
      titleStatus: "PENDING",
    },
  });
});

test("workspace capture bar listens for reconnect signals and replays queued captures into local shell state", () => {
  const source = readFileSync(WORKSPACE_CAPTURE_BAR_COMPONENT_PATH, "utf8");

  assert.match(source, /OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT/u);
  assert.match(source, /replayWorkspaceHomeQueuedCaptures\(\)/u);
  assert.match(
    source,
    /window\.addEventListener\(\s*OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,\s*handleOfflineCaptureReconnect/u,
  );
  assert.match(
    source,
    /window\.removeEventListener\(\s*OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,\s*handleOfflineCaptureReconnect/u,
  );
  assert.match(source, /markWorkspaceHomeOptimisticCaptureSaved\(/u);
  assert.match(source, /markWorkspaceHomeOptimisticCaptureFailed\(/u);
});
