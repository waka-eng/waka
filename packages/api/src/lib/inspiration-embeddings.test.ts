import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GeminiEmbeddingHttpClient,
  buildEmbedContentUrl,
} from "./inspiration-embeddings.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GeminiEmbeddingHttpClient", () => {
  it("uses the current Gemini embedding model and requests 768 dimensions", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const embedding = Array.from({ length: GEMINI_EMBEDDING_DIMENSIONS }, (_, index) => index / 1000);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ embedding: { values: embedding } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GeminiEmbeddingHttpClient().embed("find a pattern");

    expect(result).toHaveLength(768);
    expect(GEMINI_EMBEDDING_MODEL).toBe("gemini-embedding-001");
    expect(fetchMock).toHaveBeenCalledWith(buildEmbedContentUrl("gemini-embedding-001"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": "test-key",
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: "find a pattern" }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      }),
    });
  });
});
