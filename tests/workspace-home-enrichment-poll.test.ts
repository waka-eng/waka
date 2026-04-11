import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getWorkspaceHomePendingTextCaptureIds,
  pollWorkspaceHomePendingTextCaptureEnrichment,
  readWorkspaceHomeTextCaptureEnrichment,
  WORKSPACE_HOME_PENDING_TEXT_CAPTURE_POLL_INTERVAL_MS,
} from "../apps/web/src/home/text-capture-enrichment-poll.ts";
import {
  applyWorkspaceHomeTextCaptureEnrichmentUpdates,
  WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY,
} from "../apps/web/src/home/workspace-home-screen-model.ts";

const WORKSPACE_HOME_SCREEN_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-home-screen.tsx",
);

test("getWorkspaceHomePendingTextCaptureIds returns only persisted text captures still waiting on AI fields or reflection classification", () => {
  const pendingCaptureIds = getWorkspaceHomePendingTextCaptureIds([
    {
      id: "unclustered",
      itemCount: 8,
      items: [
        {
          id: "insp-text-pending",
          isSummaryPending: true,
          isTagsPending: false,
          isTitlePending: true,
          saveState: "saved",
          sourceType: "TEXT_NOTE",
          title: "Saving capture",
        },
        {
          id: "insp-reflection-pending",
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          reflectionStatus: "PENDING",
          saveState: "saved",
          sourceType: "TEXT_NOTE",
          title: "Keep polling for reflection",
        },
        {
          id: "insp-reflection-resolved",
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          reflectionStatus: "NOT_NEEDED",
          saveState: "saved",
          sourceType: "TEXT_NOTE",
          title: "Resolved capture",
        },
        {
          id: "insp-url-pending",
          isSummaryPending: true,
          isTagsPending: true,
          isTitlePending: true,
          saveState: "saved",
          sourceType: "URL_IMPORT",
          title: "URL capture",
        },
        {
          id: "optimistic-1",
          isSummaryPending: true,
          isTagsPending: true,
          isTitlePending: true,
          saveState: "saving",
          sourceType: "TEXT_NOTE",
          title: "Saving capture",
        },
        {
          id: "queued-text-capture",
          isSummaryPending: true,
          isTagsPending: true,
          isTitlePending: true,
          saveState: "queued",
          sourceType: "TEXT_NOTE",
          title: "Waiting to sync",
        },
        {
          id: "insp-text-failed",
          isSummaryPending: true,
          isTagsPending: true,
          isTitlePending: true,
          saveState: "failed",
          sourceType: "TEXT_NOTE",
          title: "Capture retry needed",
        },
      ],
      name: "Unclustered",
      summary: "Fresh captures waiting on enrichment.",
    },
  ]);

  assert.deepEqual(pendingCaptureIds, [
    "insp-text-pending",
    "insp-reflection-pending",
  ]);
});

test("readWorkspaceHomeTextCaptureEnrichment fetches a single inspiration detail payload for polling", async () => {
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];
  const enrichmentUpdate = await readWorkspaceHomeTextCaptureEnrichment(
    "insp-text-pending",
    async (input, init) => {
      requests.push({ input, init });

      return Response.json({
        id: "insp-text-pending",
        processingState: {
          fields: {
            summary: {
              status: "COMPLETED",
            },
            tags: {
              status: "PROCESSING",
            },
            title: {
              status: "COMPLETED",
            },
          },
          status: "PROCESSING",
        },
        reflectionPrompt:
          "What was the surprising part of this thought once you sat with it?",
        reflectionStatus: "PROMPTED",
        sourceType: "TEXT_NOTE",
        summary: "Summaries can resolve before tags finish processing.",
        tags: ["queue"],
        title: "Keep polling pending captures",
      });
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/inspirations/insp-text-pending");
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.deepEqual(requests[0]?.init?.headers, {
    accept: "application/json",
  });
  assert.deepEqual(enrichmentUpdate, {
    id: "insp-text-pending",
    processingState: {
      isSummaryPending: false,
      isTagsPending: true,
      isTitlePending: false,
      status: "PROCESSING",
      summaryStatus: "COMPLETED",
      tagsStatus: "PROCESSING",
      titleStatus: "COMPLETED",
    },
    reflectionPrompt:
      "What was the surprising part of this thought once you sat with it?",
    reflectionStatus: "PROMPTED",
    summary: "Summaries can resolve before tags finish processing.",
    tags: ["queue"],
    title: "Keep polling pending captures",
  });
});

test("readWorkspaceHomeTextCaptureEnrichment parses an assigned cluster when the poll response includes one", async () => {
  const enrichmentUpdate = await readWorkspaceHomeTextCaptureEnrichment(
    "insp-text-clustered",
    async () =>
      Response.json({
        cluster: {
          description:
            "Reliability notes that clustering pulled together after enrichment.",
          id: "cluster-reliability",
          label: "Capture reliability",
        },
        id: "insp-text-clustered",
        processingState: {
          fields: {
            summary: {
              status: "COMPLETED",
            },
            tags: {
              status: "COMPLETED",
            },
            title: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        sourceType: "TEXT_NOTE",
      }),
  );

  assert.deepEqual(enrichmentUpdate, {
    cluster: {
      id: "cluster-reliability",
      name: "Capture reliability",
      summary:
        "Reliability notes that clustering pulled together after enrichment.",
    },
    id: "insp-text-clustered",
    processingState: {
      isSummaryPending: false,
      isTagsPending: false,
      isTitlePending: false,
      status: "COMPLETED",
      summaryStatus: "COMPLETED",
      tagsStatus: "COMPLETED",
      titleStatus: "COMPLETED",
    },
  });
});

test("pollWorkspaceHomePendingTextCaptureEnrichment refetches only pending text captures", async () => {
  const requests: string[] = [];
  const enrichmentUpdates = await pollWorkspaceHomePendingTextCaptureEnrichment(
    [
      {
        id: "unclustered",
        itemCount: 3,
        items: [
          {
            id: "insp-text-pending",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Saving capture",
          },
          {
            id: "insp-url-pending",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            saveState: "saved",
            sourceType: "URL_IMPORT",
            title: "Queued URL",
          },
          {
            id: "insp-text-resolved",
            isSummaryPending: false,
            isTagsPending: false,
            isTitlePending: false,
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Resolved capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    async (input) => {
      requests.push(String(input));

      return Response.json({
        id: "insp-text-pending",
        processingState: {
          fields: {
            summary: {
              status: "COMPLETED",
            },
            tags: {
              status: "COMPLETED",
            },
            title: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        sourceType: "TEXT_NOTE",
        summary: "Only the pending text note should be polled.",
        tags: ["polling", "text-note"],
        title: "Target pending text captures only",
      });
    },
  );

  assert.deepEqual(requests, ["/api/inspirations/insp-text-pending"]);
  assert.deepEqual(enrichmentUpdates, [
    {
      id: "insp-text-pending",
      processingState: {
        isSummaryPending: false,
        isTagsPending: false,
        isTitlePending: false,
        status: "COMPLETED",
        summaryStatus: "COMPLETED",
        tagsStatus: "COMPLETED",
        titleStatus: "COMPLETED",
      },
      summary: "Only the pending text note should be polled.",
      tags: ["polling", "text-note"],
      title: "Target pending text captures only",
    },
  ]);
});

test("pollWorkspaceHomePendingTextCaptureEnrichment accepts an explicit active id list and avoids duplicate follow-up requests", async () => {
  const requests: string[] = [];
  const enrichmentUpdates = await pollWorkspaceHomePendingTextCaptureEnrichment(
    ["insp-text-pending", "", "insp-text-pending", "insp-text-next"],
    async (input) => {
      requests.push(String(input));

      if (String(input).endsWith("insp-text-next")) {
        return Response.json({
          id: "insp-text-next",
          processingState: {
            fields: {
              summary: {
                status: "PROCESSING",
              },
              tags: {
                status: "PROCESSING",
              },
              title: {
                status: "PROCESSING",
              },
            },
            status: "PROCESSING",
          },
          sourceType: "TEXT_NOTE",
        });
      }

      return Response.json({
        id: "insp-text-pending",
        processingState: {
          fields: {
            summary: {
              status: "COMPLETED",
            },
            tags: {
              status: "COMPLETED",
            },
            title: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        sourceType: "TEXT_NOTE",
        summary: "The active id list should drive the next polling pass.",
        tags: ["dedupe"],
        title: "Poll only once per active capture",
      });
    },
  );

  assert.deepEqual(requests, [
    "/api/inspirations/insp-text-pending",
    "/api/inspirations/insp-text-next",
  ]);
  assert.deepEqual(enrichmentUpdates, [
    {
      id: "insp-text-pending",
      processingState: {
        isSummaryPending: false,
        isTagsPending: false,
        isTitlePending: false,
        status: "COMPLETED",
        summaryStatus: "COMPLETED",
        tagsStatus: "COMPLETED",
        titleStatus: "COMPLETED",
      },
      summary: "The active id list should drive the next polling pass.",
      tags: ["dedupe"],
      title: "Poll only once per active capture",
    },
    {
      id: "insp-text-next",
      processingState: {
        isSummaryPending: true,
        isTagsPending: true,
        isTitlePending: true,
        status: "PROCESSING",
        summaryStatus: "PROCESSING",
        tagsStatus: "PROCESSING",
        titleStatus: "PROCESSING",
      },
    },
  ]);
});

test("applyWorkspaceHomeTextCaptureEnrichmentUpdates folds polled AI fields back into cluster state", () => {
  const nextClusterPreviews = applyWorkspaceHomeTextCaptureEnrichmentUpdates(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-text-pending",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            rawContent: "Polling should hydrate this capture in place.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "insp-text-pending",
        processingState: {
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          status: "COMPLETED",
          summaryStatus: "COMPLETED",
          tagsStatus: "COMPLETED",
          titleStatus: "COMPLETED",
        },
        reflectionPrompt:
          "What shifted once this note became concrete enough to save?",
        reflectionStatus: "PROMPTED",
        summary: "Polling now merges AI fields back into the same card.",
        tags: ["polling", "merge"],
        title: "Hydrate pending capture in place",
      },
    ],
  );

  assert.deepEqual(nextClusterPreviews[0]?.items?.[0], {
    id: "insp-text-pending",
    isSummaryPending: false,
    isTagsPending: false,
    isTitlePending: false,
    rawContent: "Polling should hydrate this capture in place.",
    reflectionPrompt:
      "What shifted once this note became concrete enough to save?",
    reflectionStatus: "PROMPTED",
    saveState: "saved",
    sourceType: "TEXT_NOTE",
    summary: "Polling now merges AI fields back into the same card.",
    summaryStatus: "COMPLETED",
    tags: ["polling", "merge"],
    tagsStatus: "COMPLETED",
    title: "Hydrate pending capture in place",
    titleStatus: "COMPLETED",
  });
});

test("applyWorkspaceHomeTextCaptureEnrichmentUpdates moves a capture into its assigned AI cluster", () => {
  const nextClusterPreviews = applyWorkspaceHomeTextCaptureEnrichmentUpdates(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-text-clustered",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            rawContent: "This note should leave Unclustered once clustering lands.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
      {
        id: "cluster-existing",
        itemCount: 1,
        items: [
          {
            id: "insp-existing",
            rawContent: "Existing clustered note.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Existing grouped note",
          },
        ],
        name: "Existing cluster",
        summary: "Already-clustered notes stay intact.",
      },
    ],
    [
      {
        cluster: {
          id: "cluster-reliability",
          name: "Capture reliability",
          summary: WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY,
        },
        id: "insp-text-clustered",
        processingState: {
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          status: "COMPLETED",
          summaryStatus: "COMPLETED",
          tagsStatus: "COMPLETED",
          titleStatus: "COMPLETED",
        },
        summary: "Clustering moved this note into the reliability group.",
        tags: ["cluster", "reliability"],
        title: "Grouped after enrichment",
      },
    ],
  );

  assert.equal(nextClusterPreviews.length, 2);
  assert.equal(nextClusterPreviews[0]?.id, "cluster-reliability");
  assert.deepEqual(nextClusterPreviews[0], {
    id: "cluster-reliability",
    itemCount: 1,
    items: [
      {
        id: "insp-text-clustered",
        isSummaryPending: false,
        isTagsPending: false,
        isTitlePending: false,
        rawContent: "This note should leave Unclustered once clustering lands.",
        saveState: "saved",
        sourceType: "TEXT_NOTE",
        summary: "Clustering moved this note into the reliability group.",
        summaryStatus: "COMPLETED",
        tags: ["cluster", "reliability"],
        tagsStatus: "COMPLETED",
        title: "Grouped after enrichment",
        titleStatus: "COMPLETED",
      },
    ],
    name: "Capture reliability",
    summary: WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY,
  });
  assert.equal(nextClusterPreviews[1]?.id, "cluster-existing");
});

test("applyWorkspaceHomeTextCaptureEnrichmentUpdates clears a field marker as soon as that field value arrives", () => {
  const nextClusterPreviews = applyWorkspaceHomeTextCaptureEnrichmentUpdates(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-text-partial",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            rawContent: "Partial enrichment should hydrate field-by-field.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "insp-text-partial",
        processingState: {
          isSummaryPending: true,
          isTagsPending: true,
          isTitlePending: true,
          status: "PROCESSING",
          summaryStatus: "PROCESSING",
          tagsStatus: "PROCESSING",
          titleStatus: "PROCESSING",
        },
        summary: "The summary returned before the processing status caught up.",
      },
    ],
  );

  assert.deepEqual(nextClusterPreviews[0]?.items?.[0], {
    id: "insp-text-partial",
    isSummaryPending: false,
    isTagsPending: true,
    isTitlePending: true,
    rawContent: "Partial enrichment should hydrate field-by-field.",
    saveState: "saved",
    sourceType: "TEXT_NOTE",
    summary: "The summary returned before the processing status caught up.",
    summaryStatus: "PROCESSING",
    tagsStatus: "PROCESSING",
    title: "Saving capture",
    titleStatus: "PROCESSING",
  });
});

test("applyWorkspaceHomeTextCaptureEnrichmentUpdates keeps missing AI fields pending after a partial poll update", () => {
  const nextClusterPreviews = applyWorkspaceHomeTextCaptureEnrichmentUpdates(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-text-partial-complete-flags",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            rawContent: "Partial poll updates should only resolve hydrated fields.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "insp-text-partial-complete-flags",
        processingState: {
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          status: "COMPLETED",
          summaryStatus: "COMPLETED",
          tagsStatus: "COMPLETED",
          titleStatus: "COMPLETED",
        },
        summary: "Only the summary has arrived so far.",
      },
    ],
  );

  assert.deepEqual(nextClusterPreviews[0]?.items?.[0], {
    id: "insp-text-partial-complete-flags",
    isSummaryPending: false,
    isTagsPending: true,
    isTitlePending: true,
    rawContent: "Partial poll updates should only resolve hydrated fields.",
    saveState: "saved",
    sourceType: "TEXT_NOTE",
    summary: "Only the summary has arrived so far.",
    summaryStatus: "COMPLETED",
    tagsStatus: "COMPLETED",
    title: "Saving capture",
    titleStatus: "COMPLETED",
  });
});

test("applyWorkspaceHomeTextCaptureEnrichmentUpdates does not regress a resolved field back to pending", () => {
  const nextClusterPreviews = applyWorkspaceHomeTextCaptureEnrichmentUpdates(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-text-resolved-field",
            isSummaryPending: false,
            isTagsPending: true,
            isTitlePending: false,
            rawContent: "Resolved fields should stay visible.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            summary: "A previous poll already resolved the summary.",
            title: "Resolved title",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "insp-text-resolved-field",
        processingState: {
          isSummaryPending: true,
          isTagsPending: true,
          isTitlePending: true,
          status: "PROCESSING",
          summaryStatus: "PROCESSING",
          tagsStatus: "PROCESSING",
          titleStatus: "PROCESSING",
        },
      },
    ],
  );

  assert.deepEqual(nextClusterPreviews[0]?.items?.[0], {
    id: "insp-text-resolved-field",
    isSummaryPending: false,
    isTagsPending: true,
    isTitlePending: false,
    rawContent: "Resolved fields should stay visible.",
    saveState: "saved",
    sourceType: "TEXT_NOTE",
    summary: "A previous poll already resolved the summary.",
    summaryStatus: "PROCESSING",
    tagsStatus: "PROCESSING",
    title: "Resolved title",
    titleStatus: "PROCESSING",
  });
});

test("applyWorkspaceHomeTextCaptureEnrichmentUpdates clears terminal failed title state and falls back to the saved capture text", () => {
  const nextClusterPreviews = applyWorkspaceHomeTextCaptureEnrichmentUpdates(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-text-terminal-title",
            isSummaryPending: false,
            isTagsPending: false,
            isTitlePending: true,
            rawContent: "Keep the saved capture readable even if title generation dies.",
            saveState: "saved",
            sourceType: "TEXT_NOTE",
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "insp-text-terminal-title",
        processingState: {
          isSummaryPending: false,
          isTagsPending: false,
          isTitlePending: false,
          status: "FAILED",
          summaryStatus: "COMPLETED",
          tagsStatus: "COMPLETED",
          titleStatus: "FAILED",
        },
      },
    ],
  );

  assert.deepEqual(nextClusterPreviews[0]?.items?.[0], {
    id: "insp-text-terminal-title",
    isSummaryPending: false,
    isTagsPending: false,
    isTitlePending: false,
    rawContent: "Keep the saved capture readable even if title generation dies.",
    saveState: "saved",
    sourceType: "TEXT_NOTE",
    title: "Keep the saved capture readable even if title generation dies.",
    summaryStatus: "COMPLETED",
    tagsStatus: "COMPLETED",
    titleStatus: "FAILED",
  });
});

test("workspace home screen wires a 3-second pending text capture polling loop", () => {
  const source = readFileSync(WORKSPACE_HOME_SCREEN_COMPONENT_PATH, "utf8");

  assert.equal(WORKSPACE_HOME_PENDING_TEXT_CAPTURE_POLL_INTERVAL_MS, 3000);
  assert.match(source, /getWorkspaceHomePendingTextCaptureIds/);
  assert.match(source, /pollWorkspaceHomePendingTextCaptureEnrichment/);
  assert.match(source, /applyWorkspaceHomeTextCaptureEnrichmentUpdates/);
  assert.match(source, /setInterval\(/);
  assert.match(source, /clearInterval/);
  assert.match(source, /WORKSPACE_HOME_PENDING_TEXT_CAPTURE_POLL_INTERVAL_MS/);
  assert.match(source, /isPollingPendingTextCapturesRef/);
  assert.match(source, /pendingTextCaptureIdsRef/);
  assert.match(source, /\[\.\.\.pendingTextCaptureIdsRef\.current\]/);
  assert.match(source, /getWorkspaceHomePendingTextCaptureIds\(nextClusterPreviews\)/);
});
