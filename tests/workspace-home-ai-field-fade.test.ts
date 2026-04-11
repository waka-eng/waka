import assert from "node:assert/strict";
import test from "node:test";

import {
  collectWorkspaceHomeAiFieldFadeInKeys,
  createWorkspaceHomeAiFieldTransitionKey,
} from "../apps/web/src/home/workspace-home-ai-field-fade.ts";

test("collectWorkspaceHomeAiFieldFadeInKeys returns title, summary, and tags that just resolved", () => {
  const fadeInFieldKeys = collectWorkspaceHomeAiFieldFadeInKeys(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-1",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            summary: "Saving summary placeholder",
            tags: [],
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-1",
            isSummaryPending: false,
            isTagsPending: false,
            isTitlePending: false,
            summary: "A concise summary returned from the poll.",
            tags: ["cluster", "fade-in"],
            title: "Fade in resolved AI fields",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
  );

  assert.deepEqual(fadeInFieldKeys, [
    createWorkspaceHomeAiFieldTransitionKey("insp-1", "title"),
    createWorkspaceHomeAiFieldTransitionKey("insp-1", "summary"),
    createWorkspaceHomeAiFieldTransitionKey("insp-1", "tags"),
  ]);
});

test("collectWorkspaceHomeAiFieldFadeInKeys ignores unchanged records and still-pending fields", () => {
  const fadeInFieldKeys = collectWorkspaceHomeAiFieldFadeInKeys(
    [
      {
        id: "unclustered",
        itemCount: 2,
        items: [
          {
            id: "insp-ready",
            isSummaryPending: false,
            isTagsPending: false,
            isTitlePending: false,
            summary: "Already resolved before this render.",
            tags: ["ready"],
            title: "Ready",
          },
          {
            id: "insp-processing",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "unclustered",
        itemCount: 3,
        items: [
          {
            id: "insp-ready",
            isSummaryPending: false,
            isTagsPending: false,
            isTitlePending: false,
            summary: "Already resolved before this render.",
            tags: ["ready"],
            title: "Ready",
          },
          {
            id: "insp-processing",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: false,
            title: "Still processing summary and tags",
          },
          {
            id: "insp-new",
            isSummaryPending: false,
            isTagsPending: false,
            isTitlePending: false,
            summary: "A new item should not animate on first render.",
            tags: ["new"],
            title: "New item",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
  );

  assert.deepEqual(fadeInFieldKeys, [
    createWorkspaceHomeAiFieldTransitionKey("insp-processing", "title"),
  ]);
});

test("collectWorkspaceHomeAiFieldFadeInKeys does not animate failed title fallback text", () => {
  const fadeInFieldKeys = collectWorkspaceHomeAiFieldFadeInKeys(
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-failed-title",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: true,
            title: "Saving capture",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
    [
      {
        id: "unclustered",
        itemCount: 1,
        items: [
          {
            id: "insp-failed-title",
            isSummaryPending: true,
            isTagsPending: true,
            isTitlePending: false,
            title: "Fallback title from the saved capture",
            titleStatus: "FAILED",
          },
        ],
        name: "Unclustered",
        summary: "Fresh captures waiting on enrichment.",
      },
    ],
  );

  assert.deepEqual(fadeInFieldKeys, []);
});
