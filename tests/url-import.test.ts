import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  extractUrlImportContent,
  extractUrlImportContentFromHtml,
  URL_IMPORT_FETCH_TIMEOUT_MS,
} from "../apps/web/src/import/url-import.ts";

const require = createRequire(import.meta.url);
const skipHtmlUrlImportTests = [
  "@mozilla/readability",
  "cheerio",
  "jsdom",
].some((packageName) => {
  try {
    require.resolve(packageName);
    return false;
  } catch {
    return true;
  }
});

test(
  "extractUrlImportContentFromHtml returns extracted article text with normalized OG metadata in sourceMeta",
  {
    skip: skipHtmlUrlImportTests,
  },
  async () => {
  const result = await extractUrlImportContentFromHtml({
    html: `<!doctype html>
      <html lang="en">
        <head>
          <title>Reliability Notes</title>
          <meta name="description" content="Fallback description that should not win." />
          <meta property="og:title" content="Reliability Notes" />
          <meta property="og:description" content="Reliable capture pipelines need durable metadata." />
          <meta property="og:image" content="https://cdn.example.com/og/reliability.png" />
          <meta property="og:type" content="article" />
          <link rel="icon" href="/assets/favicon.ico" />
        </head>
        <body>
          <header>Global navigation should be removed.</header>
          <main>
            <article>
              <h1>Reliability Notes</h1>
              <p>Capture reliability starts with durable persistence, resilient retries, and source metadata.</p>
              <p>Open Graph previews should be available later without refetching the page.</p>
            </article>
          </main>
          <footer>Footer links should also be removed.</footer>
        </body>
      </html>`,
    sourceUrl: "https://example.com/articles/reliability",
  });

  assert.equal(result.title, "Reliability Notes");
  assert.match(
    result.content,
    /Capture reliability starts with durable persistence, resilient retries, and source metadata\./,
  );
  assert.doesNotMatch(result.content, /Global navigation should be removed\./);
  assert.deepEqual(result.sourceMeta, {
    contentType: "article",
    domain: "example.com",
    favicon: "https://example.com/assets/favicon.ico",
    ogDescription: "Reliable capture pipelines need durable metadata.",
    ogImage: "https://cdn.example.com/og/reliability.png",
    ogTitle: "Reliability Notes",
  });
  },
);

test(
  "extractUrlImportContentFromHtml falls back to document metadata and a default favicon when OG tags are absent",
  {
    skip: skipHtmlUrlImportTests,
  },
  async () => {
  const result = await extractUrlImportContentFromHtml({
    html: `<!doctype html>
      <html lang="en">
        <head>
          <title>Fallback Metadata Title</title>
          <meta name="description" content="Fallback metadata description." />
        </head>
        <body>
          <article>
            <p>Fallback article text should still be extracted cleanly.</p>
          </article>
        </body>
      </html>`,
    sourceUrl: "https://example.com/posts/fallback-metadata",
  });

  assert.equal(result.title, "Fallback Metadata Title");
  assert.deepEqual(result.sourceMeta, {
    contentType: "article",
    domain: "example.com",
    favicon: "https://example.com/favicon.ico",
    ogDescription: "Fallback metadata description.",
    ogTitle: "Fallback Metadata Title",
  });
  },
);

test("extractUrlImportContent aborts slow URL fetches after 10 seconds with a meaningful error", async () => {
  const slowUrl = "https://example.com/slow";
  const scheduledTimeouts: Array<{
    callback: () => void;
    delay: number;
  }> = [];
  const clearedTimeoutIds: Array<ReturnType<typeof globalThis.setTimeout>> = [];

  const extractionPromise = extractUrlImportContent(
    {
      rawContent: slowUrl,
      sourceUrl: slowUrl,
    },
    {
      fetch: async (input, init) => {
        assert.equal(input, slowUrl);
        assert.deepEqual(init?.headers, {
          accept: "text/html,application/xhtml+xml",
        });
        assert.ok(init?.signal instanceof AbortSignal);

        return await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => {
              reject(
                init.signal?.reason ??
                  Object.assign(new Error("The operation was aborted."), {
                    name: "AbortError",
                  }),
              );
            },
            { once: true },
          );
        });
      },
      setTimeout: ((callback: () => void, delay: number) => {
        scheduledTimeouts.push({
          callback,
          delay,
        });

        return scheduledTimeouts.length;
      }) as typeof globalThis.setTimeout,
      clearTimeout: ((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
        clearedTimeoutIds.push(timeoutId);
      }) as typeof globalThis.clearTimeout,
    },
  );

  assert.equal(scheduledTimeouts.length, 1);
  assert.equal(scheduledTimeouts[0]?.delay, URL_IMPORT_FETCH_TIMEOUT_MS);
  scheduledTimeouts[0]?.callback();

  await assert.rejects(
    async () => extractionPromise,
    /URL import timed out after 10 seconds for https:\/\/example\.com\/slow\./,
  );

  assert.deepEqual(clearedTimeoutIds, [1]);
});
