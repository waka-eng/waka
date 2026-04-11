import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  retryWorkspaceHomeAiField,
  saveWorkspaceHomeManualAiFieldRecovery,
} from "../apps/web/src/home/ai-field-recovery.ts";
import {
  applyWorkspaceHomeManualAiFieldRecovery,
  markWorkspaceHomeAiFieldRecoveryPending,
} from "../apps/web/src/home/workspace-home-screen-model.ts";

const WORKSPACE_HOME_SCREEN_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-screen.tsx",
);

test("retryWorkspaceHomeAiField posts only the selected failed field to the rerun endpoint", async () => {
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];

  const result = await retryWorkspaceHomeAiField(
    "insp-retry",
    "summary",
    async (input, init) => {
      requests.push({ input, init });

      return Response.json({
        id: "insp-retry",
        queuedFieldNames: ["summary"],
      });
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/inspirations/insp-retry/rerun");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    fieldNames: ["summary"],
  });
  assert.deepEqual(result, {
    id: "insp-retry",
    queuedFieldNames: ["summary"],
  });
});

test("saveWorkspaceHomeManualAiFieldRecovery posts only the manually completed field", async () => {
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];

  await saveWorkspaceHomeManualAiFieldRecovery(
    "insp-manual",
    "tags",
    ["manual", "recovery"],
    async (input, init) => {
      requests.push({ input, init });
      return Response.json({
        id: "insp-manual",
      });
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/inspirations/insp-manual");
  assert.equal(requests[0]?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    tags: ["manual", "recovery"],
  });
});

test("workspace home recovery model helpers scope retry and manual completion to the targeted field", () => {
  const clusterPreviews = [
    {
      id: "unclustered",
      itemCount: 1,
      items: [
        {
          id: "insp-detail",
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          rawContent: "Keep the saved capture intact.",
          saveState: "saved" as const,
          sourceType: "TEXT_NOTE",
          summaryStatus: "FAILED" as const,
          tagsStatus: "FAILED" as const,
          title: "Existing title",
          titleStatus: "FAILED" as const,
        },
      ],
      name: "Unclustered",
      summary: "Fresh captures waiting on enrichment.",
    },
  ] as const;

  const pendingFieldClusters = markWorkspaceHomeAiFieldRecoveryPending(
    clusterPreviews,
    "insp-detail",
    "summary",
  );

  assert.equal(pendingFieldClusters[0]?.items?.[0]?.isSummaryPending, true);
  assert.equal(pendingFieldClusters[0]?.items?.[0]?.summaryStatus, "PENDING");
  assert.equal(pendingFieldClusters[0]?.items?.[0]?.tagsStatus, "FAILED");

  const manuallyRecoveredClusters = applyWorkspaceHomeManualAiFieldRecovery(
    pendingFieldClusters,
    "insp-detail",
    "tags",
    ["manual", "recovery"],
  );

  assert.equal(manuallyRecoveredClusters[0]?.items?.[0]?.isTagsPending, false);
  assert.equal(
    manuallyRecoveredClusters[0]?.items?.[0]?.tagsStatus,
    "COMPLETED",
  );
  assert.deepEqual(
    manuallyRecoveredClusters[0]?.items?.[0]?.tags,
    ["manual", "recovery"],
  );
  assert.equal(
    manuallyRecoveredClusters[0]?.items?.[0]?.titleStatus,
    "FAILED",
  );
});

test("workspace home screen renders record-detail recovery controls for terminal AI fields", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.match(source, /Finish missing details/);
  assert.match(source, /data-record-detail-ai-recovery-field=/);
  assert.match(source, /data-ai-field-retry-action=/);
  assert.match(source, /data-ai-field-manual-toggle=/);
  assert.match(source, /data-ai-field-manual-editor=/);
  assert.match(source, /data-ai-field-manual-save=/);
  assert.match(source, /handleAiFieldRetry/);
  assert.match(source, /handleManualAiFieldSave/);
  assert.match(source, /retryWorkspaceHomeAiField/);
  assert.match(source, /saveWorkspaceHomeManualAiFieldRecovery/);
  assert.match(source, /className="mt-4 grid w-full min-w-0 gap-2 md:grid-cols-2"/);
  assert.match(
    source,
    /data-ai-field-retry-action=\{field\.fieldName\}[\s\S]*className=\{`\$\{WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME\} border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 focus-visible:ring-amber-300\/70 disabled:cursor-not-allowed disabled:opacity-60`\}/,
  );
  assert.match(
    source,
    /data-ai-field-manual-toggle=\{field\.fieldName\}[\s\S]*className=\{`\$\{WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME\} border border-stone-200 bg-white text-stone-700 hover:border-stone-300 focus-visible:ring-stone-300\/60 disabled:cursor-not-allowed disabled:opacity-60`\}/,
  );
});
