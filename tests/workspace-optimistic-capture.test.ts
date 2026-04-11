import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createWorkspaceHomeOptimisticTextCapture,
  getWorkspaceHomeRecordDetail,
  markWorkspaceHomeOptimisticCaptureFailed,
  markWorkspaceHomeOptimisticCaptureQueued,
  markWorkspaceHomeOptimisticCaptureSaved,
  prependWorkspaceHomeOptimisticCapture,
  shouldRenderWorkspaceHomeInlineReflection,
  WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID,
  WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME,
  WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
} from "../apps/web/src/home/workspace-home-screen-model.ts";
import {
  createWorkspaceHomeTextCapture,
  parseWorkspaceHomeTextCaptureCreateResponse,
  queueWorkspaceHomeTextCapture,
  shouldQueueWorkspaceHomeTextCaptureFailure,
  WorkspaceHomeTextCaptureCreateStatusError,
} from "../apps/web/src/home/text-capture-create.ts";

const WORKSPACE_CAPTURE_BAR_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-capture-bar.tsx",
);
const WORKSPACE_HOME_SCREEN_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-screen.tsx",
);

test("prependWorkspaceHomeOptimisticCapture inserts a new optimistic capture at the top of local feed state", () => {
  const existingClusters = [
    {
      id: "signal-hunting",
      itemCount: 2,
      items: [
        {
          id: "insp-existing",
          rawContent: "Existing inspiration",
          sourceType: "TEXT_NOTE",
          title: "Existing inspiration",
        },
      ],
      name: "Signal hunting",
      summary: "Existing cluster summary.",
    },
  ] as const;

  const nextClusters = prependWorkspaceHomeOptimisticCapture(
    existingClusters,
    createWorkspaceHomeOptimisticTextCapture(
      "Capture immediately before the network settles.",
      "optimistic-1",
    ),
  );

  assert.equal(nextClusters[0]?.id, WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID);
  assert.equal(nextClusters[0]?.name, WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME);
  assert.equal(
    nextClusters[0]?.summary,
    WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
  );
  assert.equal(nextClusters[0]?.items?.[0]?.id, "optimistic-1");
  assert.equal(
    nextClusters[0]?.items?.[0]?.rawContent,
    "Capture immediately before the network settles.",
  );
  assert.equal(nextClusters[0]?.items?.[0]?.saveState, "saving");
  assert.equal(nextClusters[1]?.id, "signal-hunting");
  assert.equal(existingClusters.length, 1);
  assert.equal(existingClusters[0]?.id, "signal-hunting");
});

test("createWorkspaceHomeOptimisticTextCapture preserves the exact submitted text", () => {
  const submittedRawContent =
    "  First line stays padded.\nSecond line keeps its break.\n\nThird line still exists.  ";
  const optimisticCapture = createWorkspaceHomeOptimisticTextCapture(
    submittedRawContent,
    "optimistic-exact-text",
  );

  assert.equal(optimisticCapture.rawContent, submittedRawContent);
  assert.equal(optimisticCapture.isTitlePending, true);
  assert.equal(optimisticCapture.isSummaryPending, true);
  assert.equal(optimisticCapture.isTagsPending, true);
});

test("markWorkspaceHomeOptimisticCaptureSaved swaps in the persisted id and server processing state", () => {
  const savedClusters = markWorkspaceHomeOptimisticCaptureSaved(
    [
      {
        id: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID,
        itemCount: 1,
        items: [
          createWorkspaceHomeOptimisticTextCapture(
            "Keep polling until summary and tags resolve.",
            "optimistic-1",
          ),
        ],
        name: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME,
        summary: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
      },
    ],
    "optimistic-1",
    "insp-persisted",
    {
      isTagsPending: true,
      isSummaryPending: false,
      isTitlePending: true,
      summaryStatus: "COMPLETED",
      tagsStatus: "PENDING",
      titleStatus: "PROCESSING",
      status: "PROCESSING",
    },
  );

  assert.equal(savedClusters[0]?.items?.[0]?.id, "insp-persisted");
  assert.equal(savedClusters[0]?.items?.[0]?.saveState, "saved");
  assert.equal(savedClusters[0]?.items?.[0]?.syncStatus, "synced");
  assert.equal(savedClusters[0]?.items?.[0]?.isTitlePending, true);
  assert.equal(savedClusters[0]?.items?.[0]?.isSummaryPending, false);
  assert.equal(savedClusters[0]?.items?.[0]?.isTagsPending, true);
  assert.equal(savedClusters[0]?.items?.[0]?.reflectionStatus, "PENDING");
  assert.equal(savedClusters[0]?.items?.[0]?.titleStatus, "PROCESSING");
  assert.equal(savedClusters[0]?.items?.[0]?.summaryStatus, "COMPLETED");
  assert.equal(savedClusters[0]?.items?.[0]?.tagsStatus, "PENDING");
});

test("markWorkspaceHomeOptimisticCaptureQueued keeps the capture visible while local sync is pending", () => {
  const queuedClusters = markWorkspaceHomeOptimisticCaptureQueued(
    [
      {
        id: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID,
        itemCount: 1,
        items: [
          createWorkspaceHomeOptimisticTextCapture(
            "Queue this locally until the network comes back.",
            "optimistic-queued",
          ),
        ],
        name: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME,
        summary: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
      },
    ],
    "optimistic-queued",
    "queued-capture-1",
  );

  assert.equal(queuedClusters[0]?.items?.[0]?.id, "queued-capture-1");
  assert.equal(queuedClusters[0]?.items?.[0]?.saveState, "queued");
  assert.equal(queuedClusters[0]?.items?.[0]?.syncStatus, "pending-sync");
  assert.equal(queuedClusters[0]?.items?.[0]?.isTitlePending, false);
  assert.equal(queuedClusters[0]?.items?.[0]?.isSummaryPending, false);
  assert.equal(queuedClusters[0]?.items?.[0]?.isTagsPending, false);
  assert.equal(
    queuedClusters[0]?.items?.[0]?.title,
    "Queue this locally until the network comes back.",
  );
});

test("getWorkspaceHomeRecordDetail preserves the sync status for locally managed captures", () => {
  const queuedRecordDetail = getWorkspaceHomeRecordDetail(
    [
      {
        id: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID,
        itemCount: 1,
        items: [
          {
            id: "queued-capture-1",
            rawContent: "Queued locally before upload succeeds.",
            saveState: "queued",
            sourceType: "TEXT_NOTE",
            syncStatus: "pending-sync",
            title: "Queued locally before upload succeeds.",
          },
        ],
        name: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME,
        summary: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
      },
    ],
    "queued-capture-1",
  );

  assert.equal(queuedRecordDetail?.saveState, "queued");
  assert.equal(queuedRecordDetail?.syncStatus, "pending-sync");
});

test("shouldRenderWorkspaceHomeInlineReflection stays hidden until the capture has fully saved", () => {
  assert.equal(
    shouldRenderWorkspaceHomeInlineReflection({
      reflectionPrompt: "What exactly sparked this thought?",
      reflectionStatus: "PROMPTED",
      saveState: "saving",
    }),
    false,
  );
  assert.equal(
    shouldRenderWorkspaceHomeInlineReflection({
      reflectionPrompt: "What exactly sparked this thought?",
      reflectionStatus: "PROMPTED",
      saveState: "queued",
    }),
    false,
  );
  assert.equal(
    shouldRenderWorkspaceHomeInlineReflection({
      reflectionAnswer: "It connected two separate notes.",
      reflectionStatus: "ANSWERED",
      saveState: "failed",
    }),
    false,
  );
  assert.equal(
    shouldRenderWorkspaceHomeInlineReflection({
      reflectionPrompt: "What exactly sparked this thought?",
      reflectionStatus: "PROMPTED",
      saveState: "saved",
    }),
    true,
  );
  assert.equal(
    shouldRenderWorkspaceHomeInlineReflection({
      reflectionPrompt: "What exactly sparked this thought?",
      reflectionStatus: "PROMPTED",
    }),
    true,
  );
});

test("markWorkspaceHomeOptimisticCaptureFailed preserves pending-sync status for locally queued captures", () => {
  const failedClusters = markWorkspaceHomeOptimisticCaptureFailed(
    [
      {
        id: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID,
        itemCount: 1,
        items: [
          {
            id: "queued-capture-1",
            rawContent: "Keep retrying this queued capture.",
            saveState: "queued",
            sourceType: "TEXT_NOTE",
            syncStatus: "pending-sync",
            title: "Keep retrying this queued capture.",
          },
        ],
        name: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME,
        summary: WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
      },
    ],
    "queued-capture-1",
  );

  assert.equal(failedClusters[0]?.items?.[0]?.saveState, "failed");
  assert.equal(failedClusters[0]?.items?.[0]?.syncStatus, "pending-sync");
});

test("parseWorkspaceHomeTextCaptureCreateResponse returns the persisted id and pollable AI field state", () => {
  const parsedResponse = parseWorkspaceHomeTextCaptureCreateResponse({
    id: "insp-created",
    processingState: {
      fields: {
        title: {
          status: "PROCESSING",
        },
        summary: {
          status: "COMPLETED",
        },
        tags: {
          status: "PENDING",
        },
      },
      status: "PROCESSING",
    },
  });

  assert.deepEqual(parsedResponse, {
    persistedCaptureId: "insp-created",
    processingState: {
      isTagsPending: true,
      isSummaryPending: false,
      isTitlePending: true,
      status: "PROCESSING",
      summaryStatus: "COMPLETED",
      tagsStatus: "PENDING",
      titleStatus: "PROCESSING",
    },
  });
});

test("createWorkspaceHomeTextCapture posts text notes and returns the persisted id plus processing state", async () => {
  const requests: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];
  const result = await createWorkspaceHomeTextCapture(
    "Capture now and poll for enrichment later.",
    async (input, init) => {
      requests.push({ input, init });

      return Response.json({
        id: "insp-created",
        processingState: {
          fields: {
            title: {
              status: "PENDING",
            },
            summary: {
              status: "PENDING",
            },
            tags: {
              status: "PENDING",
            },
          },
          status: "PENDING",
        },
      });
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/inspirations");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    rawContent: "Capture now and poll for enrichment later.",
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(result, {
    persistedCaptureId: "insp-created",
    processingState: {
      isTagsPending: true,
      isSummaryPending: true,
      isTitlePending: true,
      status: "PENDING",
      summaryStatus: "PENDING",
      tagsStatus: "PENDING",
      titleStatus: "PENDING",
    },
  });
});

test("queueWorkspaceHomeTextCapture persists a normalized URL import into the offline queue", async () => {
  const saveCalls: Array<{ id?: string; payload: unknown }> = [];
  const queuedCapture = await queueWorkspaceHomeTextCapture(
    "Review this later: https://example.com/post",
    {
      id: "queued-url-capture",
      queueStore: {
        async deleteCapture() {},
        async getCapture() {
          return null;
        },
        async listCaptures() {
          return [];
        },
        async listPendingCaptures() {
          return [];
        },
        async markCaptureFailed(_id, _input, _expectedReplayAttempt) {
          return null;
        },
        async markCaptureQueued() {
          return null;
        },
        async markCaptureSynced(_id, _syncedAt, _expectedReplayAttempt) {
          return null;
        },
        async markCaptureSyncing() {
          return null;
        },
        async saveCapture(input) {
          saveCalls.push(input);

          return {
            createdAt: "2026-04-11T00:00:00.000Z",
            id: input.id ?? "generated-queued-id",
            payload: input.payload,
            retry: {
              attemptCount: 0,
            },
            status: "queued" as const,
            updatedAt: "2026-04-11T00:00:00.000Z",
          };
        },
      },
    },
  );

  assert.deepEqual(saveCalls, [
    {
      id: "queued-url-capture",
      payload: {
        rawContent: "Review this later",
        sourceType: "URL_IMPORT",
        sourceUrl: "https://example.com/post",
      },
    },
  ]);
  assert.equal(queuedCapture.id, "queued-url-capture");
  assert.equal(queuedCapture.status, "queued");
});

test("shouldQueueWorkspaceHomeTextCaptureFailure only retries transient submission failures", () => {
  assert.equal(
    shouldQueueWorkspaceHomeTextCaptureFailure(new TypeError("fetch failed")),
    true,
  );
  assert.equal(
    shouldQueueWorkspaceHomeTextCaptureFailure(
      new WorkspaceHomeTextCaptureCreateStatusError(503),
    ),
    true,
  );
  assert.equal(
    shouldQueueWorkspaceHomeTextCaptureFailure(
      new WorkspaceHomeTextCaptureCreateStatusError(400),
    ),
    false,
  );
});

test("workspace capture bar submit flow inserts optimistic local state before awaiting the create request", () => {
  const captureBarSource = readFileSync(
    WORKSPACE_CAPTURE_BAR_COMPONENT_PATH,
    "utf8",
  );
  const screenSource = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");
  const optimisticInsertIndex = captureBarSource.indexOf(
    "resolvedSetClusterPreviews((currentClusterPreviews) =>",
  );
  const createRequestIndex = captureBarSource.indexOf(
    "await createWorkspaceHomeTextCapture(submittedRawContent)",
  );

  assert.notEqual(optimisticInsertIndex, -1);
  assert.notEqual(createRequestIndex, -1);
  assert.ok(optimisticInsertIndex < createRequestIndex);
  assert.match(captureBarSource, /resolvedSetClusterPreviews/u);
  assert.match(captureBarSource, /prependWorkspaceHomeOptimisticCapture/u);
  assert.match(captureBarSource, /createWorkspaceHomeOptimisticTextCapture/u);
  assert.match(captureBarSource, /createWorkspaceHomeTextCapture/u);
  assert.match(captureBarSource, /const submittedRawContent = captureDraft;/u);
  assert.match(captureBarSource, /const \{ persistedCaptureId, processingState \} =/u);
  assert.match(
    captureBarSource,
    /createWorkspaceHomeOptimisticTextCapture\(\s*submittedRawContent,/u,
  );
  assert.match(
    captureBarSource,
    /markWorkspaceHomeOptimisticCaptureSaved\([\s\S]*processingState/u,
  );
  assert.match(captureBarSource, /navigator\.onLine === false/u);
  assert.match(captureBarSource, /queueWorkspaceHomeTextCapture\(/u);
  assert.match(
    captureBarSource,
    /shouldQueueWorkspaceHomeTextCaptureFailure\(error\)/u,
  );
  assert.match(
    captureBarSource,
    /markWorkspaceHomeOptimisticCaptureQueued\(/u,
  );
  assert.match(
    screenSource,
    /item\.isTitlePending \|\| item\.isSummaryPending \|\| item\.isTagsPending/u,
  );
  assert.match(screenSource, /data-cluster-item-ai-title="pending"/u);
  assert.match(screenSource, /data-cluster-item-ai-summary="pending"/u);
  assert.match(screenSource, /data-cluster-item-ai-tags="pending"/u);
  assert.match(screenSource, /data-cluster-item-ai-title-transition=/u);
  assert.match(screenSource, /data-cluster-item-ai-summary-transition=/u);
  assert.match(screenSource, /data-cluster-item-ai-tags-transition=/u);
  assert.match(screenSource, /WORKSPACE_HOME_AI_FIELD_FADE_IN_CLASS_NAME/u);
  assert.match(screenSource, /data-cluster-item-ai-title-terminal=/u);
  assert.match(screenSource, /data-cluster-item-ai-summary-terminal=/u);
  assert.match(screenSource, /data-cluster-item-ai-tags-terminal=/u);
  assert.match(screenSource, /data-cluster-item-sync-status=/u);
  assert.match(screenSource, /item\.syncStatus === "pending-sync"/u);
  assert.match(screenSource, /data-cluster-item-status-badge=/u);
  assert.match(screenSource, /getWorkspaceHomeCaptureStatusBadges\(selectedRecordDetail\)/u);
  assert.match(screenSource, /data-record-detail-status-badge=/u);
  assert.match(screenSource, /data-record-detail-reflection=/u);
  assert.match(screenSource, /Something to think about/u);
  assert.match(screenSource, /data-record-detail-drawer="open"/u);
  assert.match(screenSource, /role="dialog"/u);
  assert.match(screenSource, /Finish missing details/u);
  assert.match(screenSource, /Needs input/u);
  assert.match(screenSource, /Saving when online/u);
  assert.match(screenSource, /whitespace-pre-wrap/u);
});
