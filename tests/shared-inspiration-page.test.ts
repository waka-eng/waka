import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type {
  SharedInspirationPersistenceArgs,
  SharedInspirationPersistenceClient,
  SharedInspirationRecord,
} from "../apps/web/src/sharing/shared-inspiration-page-data.ts";
import {
  buildSharedInspirationCanonicalUrl,
  buildSharedInspirationOpenGraphImageUrl,
  loadSharedInspirationPageMetadata,
  resolveSharedInspirationMetadataBaseUrl,
  SHARED_INSPIRATION_METADATA_TWITTER_CARD,
} from "../apps/web/src/sharing/shared-inspiration-page-metadata.ts";
import {
  buildSharedInspirationPersistenceArgs,
  loadSharedInspirationPageData,
} from "../apps/web/src/sharing/shared-inspiration-page-data.ts";
import {
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
} from "../apps/web/src/sharing/shared-inspiration-open-graph-image.ts";

type SeededSharedInspiration = {
  createdAt: string;
  deletedAt?: string | null;
  domain?: string | null;
  isPublic: boolean;
  rawContent: string;
  shareSlug: string;
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
};

class StubSharedInspirationPersistenceClient
  implements SharedInspirationPersistenceClient<SharedInspirationRecord>
{
  readonly findFirstCalls: SharedInspirationPersistenceArgs[] = [];
  private readonly inspirations: readonly SeededSharedInspiration[];

  constructor(inspirations: readonly SeededSharedInspiration[]) {
    this.inspirations = inspirations;
  }

  readonly inspiration = {
    findFirst: async (
      args: SharedInspirationPersistenceArgs,
    ): Promise<SharedInspirationRecord | null> => {
      this.findFirstCalls.push(args);

      const record =
        this.inspirations.find(
          (candidate) =>
            candidate.shareSlug === args.where.shareSlug &&
            candidate.isPublic === args.where.isPublic &&
            candidate.deletedAt == null,
        ) ?? null;

      if (record === null) {
        return null;
      }

      return {
        createdAt: record.createdAt,
        domain: record.domain,
        rawContent: record.rawContent,
        shareSlug: record.shareSlug,
        sourceType: record.sourceType,
        sourceUrl: record.sourceUrl,
        summary: record.summary,
        tags: record.tags,
        title: record.title,
      };
    },
  };
}

const SHARE_ROUTE_PATH = path.join(
  process.cwd(),
  "apps/web/app/s/[slug]/page.tsx",
);
const SHARED_INSPIRATION_CARD_PATH = path.join(
  process.cwd(),
  "apps/web/app/s/[slug]/shared-inspiration-card.tsx",
);
const SHARED_INSPIRATION_PAGE_PATH = path.join(
  process.cwd(),
  "apps/web/app/s/[slug]/shared-inspiration-page.tsx",
);
const MIDDLEWARE_PATH = path.join(process.cwd(), "apps/web/middleware.ts");

test("shared inspiration lookup only targets public, non-deleted records by share slug", () => {
  assert.deepEqual(
    buildSharedInspirationPersistenceArgs("insp_publicshare"),
    {
      where: {
        deletedAt: null,
        isPublic: true,
        shareSlug: "insp_publicshare",
      },
      select: {
        createdAt: true,
        domain: true,
        rawContent: true,
        shareSlug: true,
        sourceType: true,
        sourceUrl: true,
        summary: true,
        tags: true,
        title: true,
      },
    },
  );
});

test("shared inspiration page data falls back to raw content when AI fields are missing", async () => {
  const persistence = new StubSharedInspirationPersistenceClient([
    {
      createdAt: "2026-04-11T09:30:00.000Z",
      domain: null,
      isPublic: true,
      rawContent:
        "  Capture bars should stay visible even when the device reconnects.  ",
      shareSlug: "insp_publicshare",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://www.openai.com/blog/waka",
      summary: null,
      tags: [" capture ", "", "resilience"],
      title: null,
    },
  ]);

  const data = await loadSharedInspirationPageData("insp_publicshare", {
    persistence,
  });

  assert.deepEqual(persistence.findFirstCalls, [
    buildSharedInspirationPersistenceArgs("insp_publicshare"),
  ]);
  assert.equal(
    data.title,
    "Capture bars should stay visible even when the device reconnects.",
  );
  assert.equal(
    data.summary,
    "Capture bars should stay visible even when the device reconnects.",
  );
  assert.equal(data.domain, "openai.com");
  assert.equal(data.createdLabel, "Apr 11, 2026");
  assert.equal(data.sourceLabel, "URL import");
  assert.equal(data.sourceLabelShort, "URL");
  assert.deepEqual(data.tags, ["capture", "resilience"]);
});

test("shared inspiration page metadata points og and twitter images at the slug-specific og route", async () => {
  const metadata = await loadSharedInspirationPageMetadata(
    "insp_publicshare",
    async () => ({
      createdAt: "2026-04-11T09:30:00.000Z",
      createdLabel: "Apr 11, 2026",
      domain: "openai.com",
      rawContent: "Capture must never be silently lost.",
      shareSlug: "insp_publicshare",
      sourceType: "URL_IMPORT",
      sourceLabel: "URL import",
      sourceLabelShort: "URL",
      sourceUrl: "https://www.openai.com/blog/waka",
      summary: "Capture must never be silently lost when the app reconnects.",
      tags: ["capture"],
      title: "Offline capture stays reliable",
    }),
    {
      APP_URL: "https://waka.example.com",
    } as NodeJS.ProcessEnv,
  );

  const metadataBase = resolveSharedInspirationMetadataBaseUrl({
    APP_URL: "https://waka.example.com",
  } as NodeJS.ProcessEnv);
  const canonicalUrl = buildSharedInspirationCanonicalUrl(
    "insp_publicshare",
    metadataBase,
  );
  const imageUrl = buildSharedInspirationOpenGraphImageUrl(
    "insp_publicshare",
    metadataBase,
  );

  assert.equal(metadata.metadataBase?.toString(), "https://waka.example.com/");
  assert.equal(metadata.title, "Offline capture stays reliable | Waka share");
  assert.equal(
    metadata.description,
    "Capture must never be silently lost when the app reconnects.",
  );
  assert.equal(metadata.alternates?.canonical, canonicalUrl);
  assert.deepEqual(metadata.openGraph, {
    type: "article",
    url: canonicalUrl,
    title: "Offline capture stays reliable | Waka share",
    description: "Capture must never be silently lost when the app reconnects.",
    siteName: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
    images: [
      {
        url: imageUrl,
        width: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
        height: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
        alt: "Offline capture stays reliable | Waka share",
      },
    ],
  });
  assert.deepEqual(metadata.twitter, {
    card: SHARED_INSPIRATION_METADATA_TWITTER_CARD,
    title: "Offline capture stays reliable | Waka share",
    description: "Capture must never be silently lost when the app reconnects.",
    images: [imageUrl],
  });
});

test("shared inspiration card source stays public-facing and capture-focused", () => {
  const cardSource = readFileSync(SHARED_INSPIRATION_CARD_PATH, "utf8");

  assert.match(cardSource, /data-page="shared-inspiration"/u);
  assert.match(cardSource, />\s*Waka share\s*</u);
  assert.match(cardSource, /Shared note/u);
  assert.match(cardSource, /Saved note/u);
  assert.match(cardSource, /This note was shared from a private Waka workspace\./u);
  assert.doesNotMatch(cardSource, /AuthenticatedAppPageOutlet|WorkspaceCaptureBar/u);
});

test("public share route lives outside the authenticated shell and stays out of auth middleware matchers", () => {
  assert.equal(existsSync(SHARE_ROUTE_PATH), true);

  const routeSource = readFileSync(SHARE_ROUTE_PATH, "utf8");
  const pageSource = readFileSync(SHARED_INSPIRATION_PAGE_PATH, "utf8");
  const middlewareSource = readFileSync(MIDDLEWARE_PATH, "utf8");

  assert.match(
    routeSource,
    /loadSharedInspirationPageMetadata/u,
  );
  assert.match(routeSource, /export async function generateMetadata/u);
  assert.match(routeSource, /return SharedInspirationPublicPage\(props\);/u);
  assert.match(routeSource, /export const dynamic = "force-dynamic";/u);
  assert.doesNotMatch(
    pageSource,
    /AuthenticatedAppPageOutlet|WorkspaceCaptureBar|hasAuthSessionCookie|cookies\(|redirect\(/u,
  );
  assert.doesNotMatch(middlewareSource, /\/s\/:path\*/u);
});
