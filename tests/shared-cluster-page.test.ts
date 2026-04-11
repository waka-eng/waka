import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  SharedClusterPersistenceArgs,
  SharedClusterPersistenceClient,
  SharedClusterRecord,
} from "../apps/web/src/sharing/shared-cluster-page-data.ts";
import {
  buildSharedClusterPersistenceArgs,
  loadSharedClusterPageData,
} from "../apps/web/src/sharing/shared-cluster-page-data.ts";
import { loadSharedPublicPageData } from "../apps/web/src/sharing/shared-public-page-data.ts";
import { SharedInspirationNotFoundError } from "../apps/web/src/sharing/shared-inspiration-page-data.ts";

type SeededSharedCluster = {
  createdAt: string;
  description?: string | null;
  id: string;
  inspirations: Array<{
    createdAt: string;
    deletedAt?: string | null;
    domain?: string | null;
    id: string;
    isPublic: boolean;
    rawContent: string;
    shareSlug?: string | null;
    sourceType:
      | "AI_CONVERSATION"
      | "CLI_CONVERSATION"
      | "PHOTO"
      | "TEXT_NOTE"
      | "URL_IMPORT"
      | "VOICE_NOTE";
    sourceUrl?: string | null;
    summary?: string | null;
    tags?: string[] | null;
    title?: string | null;
  }>;
  isPublic: boolean;
  label: string;
  shareSlug: string;
};

class StubSharedClusterPersistenceClient
  implements SharedClusterPersistenceClient<SharedClusterRecord>
{
  readonly findFirstCalls: SharedClusterPersistenceArgs[] = [];
  private readonly clusters: readonly SeededSharedCluster[];

  constructor(clusters: readonly SeededSharedCluster[]) {
    this.clusters = clusters;
  }

  readonly cluster = {
    findFirst: async (
      args: SharedClusterPersistenceArgs,
    ): Promise<SharedClusterRecord | null> => {
      this.findFirstCalls.push(args);

      const record =
        this.clusters.find(
          (candidate) =>
            candidate.shareSlug === args.where.shareSlug &&
            candidate.isPublic === args.where.isPublic,
        ) ?? null;

      if (record === null) {
        return null;
      }

      return {
        createdAt: record.createdAt,
        description: record.description,
        id: record.id,
        inspirations: record.inspirations
          .filter(
            (candidate) =>
              candidate.deletedAt == null && candidate.isPublic === true,
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .map((inspiration) => ({
            createdAt: inspiration.createdAt,
            domain: inspiration.domain,
            id: inspiration.id,
            rawContent: inspiration.rawContent,
            shareSlug: inspiration.shareSlug,
            sourceType: inspiration.sourceType,
            sourceUrl: inspiration.sourceUrl,
            summary: inspiration.summary,
            tags: inspiration.tags,
            title: inspiration.title,
          })),
        label: record.label,
        shareSlug: record.shareSlug,
      };
    },
  };
}

test("shared cluster lookup targets public clusters and only public, non-deleted inspirations", () => {
  assert.deepEqual(buildSharedClusterPersistenceArgs("cluster_publicshare"), {
    where: {
      isPublic: true,
      shareSlug: "cluster_publicshare",
    },
    select: {
      createdAt: true,
      description: true,
      id: true,
      inspirations: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          createdAt: true,
          domain: true,
          id: true,
          rawContent: true,
          shareSlug: true,
          sourceType: true,
          sourceUrl: true,
          summary: true,
          tags: true,
          title: true,
        },
        where: {
          deletedAt: null,
          isPublic: true,
        },
      },
      label: true,
      shareSlug: true,
    },
  });
});

test("shared cluster page data excludes private inspirations from mixed-visibility clusters", async () => {
  const persistence = new StubSharedClusterPersistenceClient([
    {
      createdAt: "2026-04-11T09:30:00.000Z",
      description: "Resilience notes that stayed connected over time.",
      id: "cluster-1",
      inspirations: [
        {
          createdAt: "2026-04-11T09:35:00.000Z",
          id: "insp-public-2",
          isPublic: true,
          rawContent: "Queued writes should replay after reconnecting.",
          shareSlug: "insp_public_2",
          sourceType: "VOICE_NOTE",
          summary: "Queued writes replay after reconnecting.",
          tags: ["offline", "queue"],
          title: "Reconnect replay",
        },
        {
          createdAt: "2026-04-11T09:34:00.000Z",
          deletedAt: null,
          id: "insp-private",
          isPublic: false,
          rawContent: "This private capture must not leak into the shared page.",
          sourceType: "TEXT_NOTE",
          summary: "Private capture.",
          title: "Private note",
        },
        {
          createdAt: "2026-04-11T09:33:00.000Z",
          deletedAt: "2026-04-11T10:00:00.000Z",
          id: "insp-deleted",
          isPublic: true,
          rawContent: "Deleted captures must stay hidden too.",
          sourceType: "TEXT_NOTE",
          summary: "Deleted capture.",
          title: "Deleted note",
        },
        {
          createdAt: "2026-04-11T09:32:00.000Z",
          domain: null,
          id: "insp-public-1",
          isPublic: true,
          rawContent:
            "Capture bars should stay pinned even while background retries finish.",
          shareSlug: "insp_public_1",
          sourceType: "URL_IMPORT",
          sourceUrl: "https://www.openai.com/blog/waka",
          summary: null,
          tags: [" capture ", "", "pwa"],
          title: null,
        },
      ],
      isPublic: true,
      label: "Capture reliability",
      shareSlug: "cluster_publicshare",
    },
  ]);

  const data = await loadSharedClusterPageData("cluster_publicshare", {
    persistence,
  });

  assert.deepEqual(persistence.findFirstCalls, [
    buildSharedClusterPersistenceArgs("cluster_publicshare"),
  ]);
  assert.equal(data.label, "Capture reliability");
  assert.equal(data.itemCount, 2);
  assert.deepEqual(
    data.inspirations.map((inspiration) => inspiration.id),
    ["insp-public-2", "insp-public-1"],
  );
  assert.equal(
    data.inspirations.some(
      (inspiration) => inspiration.title === "Private note",
    ),
    false,
  );
  assert.equal(data.inspirations[1]?.domain, "openai.com");
  assert.deepEqual(data.inspirations[1]?.tags, ["capture", "pwa"]);
});

test("shared public page lookup falls back to shared clusters when no shared inspiration exists for the slug", async () => {
  const page = await loadSharedPublicPageData("cluster_publicshare", {
    async loadInspiration() {
      throw new SharedInspirationNotFoundError();
    },
    async loadCluster() {
      return {
        createdAt: "2026-04-11T09:30:00.000Z",
        createdLabel: "Apr 11, 2026",
        description: "Two related public captures.",
        id: "cluster-1",
        inspirations: [],
        itemCount: 0,
        label: "Capture reliability",
        shareSlug: "cluster_publicshare",
      };
    },
  });

  assert.equal(page.kind, "cluster");
  assert.equal(page.shareSlug, "cluster_publicshare");
  assert.equal(page.label, "Capture reliability");
});

test("shared cluster card copy states that private inspirations stay excluded from the public page", () => {
  const cardSource = readFileSync(
    "apps/web/app/s/[slug]/shared-cluster-card.tsx",
    "utf8",
  );

  assert.match(cardSource, /data-page="shared-cluster"/u);
  assert.match(
    cardSource,
    /Only public captures[\s\S]*inside this cluster appear here\./u,
  );
  assert.match(cardSource, /private captures excluded/u);
});
