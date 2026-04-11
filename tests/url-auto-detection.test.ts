import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceHomeOptimisticTextCapture } from "../apps/web/src/home/workspace-home-screen-model.ts";
import { createWorkspaceHomeTextCapture } from "../apps/web/src/home/text-capture-create.ts";
import { parseCreateInspirationRequestBody } from "../apps/web/src/inspirations/create-route.ts";
import { normalizeUrlDetectedCapture } from "../apps/web/src/inspirations/url-detection.ts";

test("normalizeUrlDetectedCapture converts a bare URL into a URL import without losing the URL body", () => {
  assert.deepEqual(
    normalizeUrlDetectedCapture({
      rawContent: "https://example.com/article",
      sourceType: "TEXT_NOTE",
    }),
    {
      rawContent: "https://example.com/article",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://example.com/article",
    },
  );
});

test("normalizeUrlDetectedCapture splits commentary from a single detected URL", () => {
  assert.deepEqual(
    normalizeUrlDetectedCapture({
      rawContent: "Great article: https://example.com/article",
      sourceType: "TEXT_NOTE",
    }),
    {
      rawContent: "Great article",
      sourceType: "URL_IMPORT",
      sourceUrl: "https://example.com/article",
    },
  );
});

test("normalizeUrlDetectedCapture leaves multi-URL text untouched so capture remains lossless", () => {
  assert.deepEqual(
    normalizeUrlDetectedCapture({
      rawContent:
        "Compare https://example.com/a with https://example.com/b before deciding.",
      sourceType: "TEXT_NOTE",
    }),
    {
      rawContent:
        "Compare https://example.com/a with https://example.com/b before deciding.",
      sourceType: "TEXT_NOTE",
    },
  );
});

test("parseCreateInspirationRequestBody auto-detects a URL import from text-note commentary", async () => {
  const parsedRequestBody = await parseCreateInspirationRequestBody(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "Great read: https://example.com/article",
        sourceType: "TEXT_NOTE",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsedRequestBody, {
    rawContent: "Great read",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/article",
  });
});

test("createWorkspaceHomeOptimisticTextCapture shows mixed URL captures as URL imports immediately", () => {
  const optimisticCapture = createWorkspaceHomeOptimisticTextCapture(
    "Save this for later: https://example.com/post",
    "optimistic-url-1",
  );

  assert.equal(optimisticCapture.rawContent, "Save this for later");
  assert.equal(optimisticCapture.sourceType, "URL_IMPORT");
  assert.equal(optimisticCapture.saveState, "saving");
});

test("createWorkspaceHomeTextCapture posts URL imports with split commentary when a single URL is detected", async () => {
  const requests: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];

  await createWorkspaceHomeTextCapture(
    "Check this out: https://example.com/post",
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
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    rawContent: "Check this out",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/post",
  });
});
