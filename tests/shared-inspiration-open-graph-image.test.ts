import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildSharedInspirationOpenGraphImageLookupFallbackModel,
  buildSharedInspirationOpenGraphImageLookupFallbackResponseHeaders,
  buildSharedInspirationOpenGraphImageResponseHeaders,
  loadSharedInspirationOpenGraphImageModel,
  normalizeSharedInspirationOpenGraphImageModel,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CACHE_CONTROL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CONTENT_TYPE,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_LOOKUP_FALLBACK_CACHE_CONTROL,
  SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH,
} from "../apps/web/src/sharing/shared-inspiration-open-graph-image.ts";
import { SharedInspirationNotFoundError } from "../apps/web/src/sharing/shared-inspiration-page-data.ts";
import {
  SHARED_INSPIRATION_FALLBACK_SUMMARY,
  SHARED_INSPIRATION_FALLBACK_TITLE,
} from "../apps/web/src/sharing/shared-inspiration-page-data.ts";

const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_ROUTE_PATH = path.join(
  process.cwd(),
  "apps/web/app/s/[slug]/opengraph-image/route.tsx",
);
const SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_TEMPLATE_PATH = path.join(
  process.cwd(),
  "apps/web/src/sharing/shared-inspiration-open-graph-image-template.ts",
);

test("shared inspiration og image model keeps share metadata and trims long summaries", async () => {
  const model = await loadSharedInspirationOpenGraphImageModel(
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
      summary:
        "Capture must never be silently lost when the app goes offline and comes back online, so the card preview should still show a concise, readable summary that fits inside the Open Graph image without spilling over awkwardly.",
      tags: ["capture"],
      title: "Offline capture stays reliable",
    }),
  );

  assert.deepEqual(model, {
    createdLabel: "Apr 11, 2026",
    domain: "openai.com",
    shareSlug: "insp_publicshare",
    sourceLabel: "URL import",
    sourceLabelShort: "URL",
    summarySnippet:
      "Capture must never be silently lost when the app goes offline and comes back online, so the card preview should still show a concise, readable summary that fits inside the Open...",
    title: "Offline capture stays reliable",
  });
});

test("shared inspiration og image model returns null for missing public shares", async () => {
  const model = await loadSharedInspirationOpenGraphImageModel(
    "missing-share",
    async () => {
      throw new SharedInspirationNotFoundError();
    },
  );

  assert.equal(model, null);
});

test("shared inspiration og image model normalizes missing optional fields to safe defaults", async () => {
  const normalizedModel = normalizeSharedInspirationOpenGraphImageModel(
    {
      createdLabel: "   ",
      domain: "   ",
      shareSlug: "   ",
      sourceLabel: null,
      sourceLabelShort: undefined,
      summarySnippet: "",
      title: " \n ",
    },
    "insp_fallback_share",
  );

  assert.deepEqual(normalizedModel, {
    createdLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
    shareSlug: "insp_fallback_share",
    sourceLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
    sourceLabelShort:
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
    summarySnippet: SHARED_INSPIRATION_FALLBACK_SUMMARY,
    title: SHARED_INSPIRATION_FALLBACK_TITLE,
  });

  const loadedModel = await loadSharedInspirationOpenGraphImageModel(
    "insp_runtime_missing_fields",
    async () =>
      ({
        createdLabel: "   ",
        domain: null,
        shareSlug: "   ",
        sourceLabel: undefined,
        sourceLabelShort: "   ",
        summary: null,
        title: undefined,
      }) as never,
  );

  assert.deepEqual(loadedModel, {
    createdLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
    shareSlug: "insp_runtime_missing_fields",
    sourceLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
    sourceLabelShort:
      SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
    summarySnippet: SHARED_INSPIRATION_FALLBACK_SUMMARY,
    title: SHARED_INSPIRATION_FALLBACK_TITLE,
  });
});

test("shared inspiration og image model tolerates an absent template payload", () => {
  assert.deepEqual(
    normalizeSharedInspirationOpenGraphImageModel(
      undefined,
      "insp_missing_payload",
    ),
    {
      createdLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
      shareSlug: "insp_missing_payload",
      sourceLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
      sourceLabelShort:
        SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
      summarySnippet: SHARED_INSPIRATION_FALLBACK_SUMMARY,
      title: SHARED_INSPIRATION_FALLBACK_TITLE,
    },
  );

  assert.deepEqual(
    normalizeSharedInspirationOpenGraphImageModel(null, "insp_null_payload"),
    {
      createdLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
      shareSlug: "insp_null_payload",
      sourceLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
      sourceLabelShort:
        SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
      summarySnippet: SHARED_INSPIRATION_FALLBACK_SUMMARY,
      title: SHARED_INSPIRATION_FALLBACK_TITLE,
    },
  );
});

test("shared inspiration og image response headers expose png dimensions and cache policy", () => {
  assert.equal(
    SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL,
    "Waka share",
  );
  assert.equal(SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH, 1200);
  assert.equal(SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT, 630);
  assert.deepEqual(buildSharedInspirationOpenGraphImageResponseHeaders(), {
    "cache-control": SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CACHE_CONTROL,
    "content-type": SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CONTENT_TYPE,
  });
});

test("shared inspiration og image lookup fallback model renders a branded default card", () => {
  assert.deepEqual(
    buildSharedInspirationOpenGraphImageLookupFallbackModel("missing-share"),
    {
      createdLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_CREATED_LABEL,
      shareSlug: "missing-share",
      sourceLabel: SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL,
      sourceLabelShort:
        SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_FALLBACK_SOURCE_LABEL_SHORT,
      summarySnippet: SHARED_INSPIRATION_FALLBACK_SUMMARY,
      title: SHARED_INSPIRATION_FALLBACK_TITLE,
    },
  );
});

test("shared inspiration og image lookup fallback response headers stay uncached", () => {
  assert.deepEqual(
    buildSharedInspirationOpenGraphImageLookupFallbackResponseHeaders(),
    {
      "cache-control":
        SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_LOOKUP_FALLBACK_CACHE_CONTROL,
      "content-type": SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_CONTENT_TYPE,
    },
  );
});

test("shared inspiration og image template defines a server-safe branded card layout", () => {
  assert.equal(existsSync(SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_TEMPLATE_PATH), true);

  const templateSource = readFileSync(
    SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_TEMPLATE_PATH,
    "utf8",
  );

  assert.match(
    templateSource,
    /SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_BRAND_LABEL/u,
  );
  assert.match(templateSource, /image\?: SharedInspirationOpenGraphImageModelInput \| null;/u);
  assert.match(
    templateSource,
    /props: SharedInspirationOpenGraphImageTemplateProps = \{\}/u,
  );
  assert.match(templateSource, /normalizeSharedInspirationOpenGraphImageModel/u);
  assert.match(templateSource, /image\.title/u);
  assert.match(templateSource, /image\.summarySnippet/u);
  assert.match(templateSource, /image\.sourceLabelShort/u);
  assert.match(templateSource, /image\.sourceLabel/u);
  assert.match(templateSource, /image\.createdLabel/u);
  assert.match(templateSource, /image\.domain/u);
  assert.match(templateSource, /Shared inspiration/u);
  assert.doesNotMatch(templateSource, /["']use client["']/u);
  assert.doesNotMatch(templateSource, /\buseEffect\b|\buseState\b|window\./u);
});

test("shared inspiration og image route is wired through next og with the share slug path", () => {
  assert.equal(existsSync(SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_ROUTE_PATH), true);
  assert.equal(existsSync(SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_TEMPLATE_PATH), true);

  const routeSource = readFileSync(
    SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_ROUTE_PATH,
    "utf8",
  );

  assert.match(routeSource, /from "next\/og"/u);
  assert.match(routeSource, /export const dynamic = "force-dynamic";/u);
  assert.match(routeSource, /new ImageResponse/u);
  assert.match(routeSource, /loadSharedInspirationOpenGraphImageModel/u);
  assert.match(
    routeSource,
    /buildSharedInspirationOpenGraphImageLookupFallbackModel/u,
  );
  assert.match(
    routeSource,
    /buildSharedInspirationOpenGraphImageLookupFallbackResponseHeaders/u,
  );
  assert.match(routeSource, /SharedInspirationOpenGraphImageTemplate/u);
  assert.match(routeSource, /SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_WIDTH/u);
  assert.match(routeSource, /SHARED_INSPIRATION_OPEN_GRAPH_IMAGE_HEIGHT/u);
  assert.doesNotMatch(
    routeSource,
    /buildSharedInspirationOpenGraphImageNotFoundResponse/u,
  );
});
