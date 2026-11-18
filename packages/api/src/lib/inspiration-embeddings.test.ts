import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCanonicalInspirationEmbeddingInput,
  hashEmbeddingInput,
} from "./inspiration-embeddings.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const inspiration = {
  text: "A small studio near serious peers made the work feel possible.",
  kind: "note" as const,
};

describe("canonical inspiration embedding input", () => {
  it("carries the reflections written on a capture", () => {
    const base = buildCanonicalInspirationEmbeddingInput(inspiration);
    const withReflection = buildCanonicalInspirationEmbeddingInput({
      ...inspiration,
      reflections: [
        {
          question: "What does this ask for?",
          answer: "Protected morning light with serious peers nearby.",
          skipped: false,
          createdAt: new Date("2026-05-30T12:01:00.000Z"),
        },
      ],
    });

    expect(withReflection).toContain("What does this ask for?");
    expect(withReflection).toContain("Protected morning light");
    expect(hashEmbeddingInput(withReflection)).not.toBe(hashEmbeddingInput(base));
  });

  it("ignores a question that was offered and declined", () => {
    // A skipped prompt records that someone chose not to answer. It says
    // nothing about the capture's content, so it must not move the vector.
    const skipped = buildCanonicalInspirationEmbeddingInput({
      ...inspiration,
      reflections: [
        {
          question: "What does this ask for?",
          answer: null,
          skipped: true,
          createdAt: new Date("2026-05-30T12:01:00.000Z"),
        },
      ],
    });
    expect(skipped).toBe(buildCanonicalInspirationEmbeddingInput(inspiration));
  });

  it("carries what an attachment turned out to say", () => {
    // The reason enrichment exists: without the page's own words, a link
    // embeds as a URL, which resembles every other URL and nothing else.
    const bareLink = { text: "https://example.com/talk", kind: "link" as const };
    const enriched = buildCanonicalInspirationEmbeddingInput({
      ...bareLink,
      attachments: [
        {
          type: "link" as const,
          enrichmentText: "Why cities stopped building — the piece argues zoning did it.",
        },
      ],
    });

    expect(enriched).toContain("attachment_1_link:");
    expect(enriched).toContain("Why cities stopped building");
    expect(hashEmbeddingInput(enriched)).not.toBe(
      hashEmbeddingInput(buildCanonicalInspirationEmbeddingInput(bareLink)),
    );
  });

  it("is unchanged by an attachment that has not been read yet", () => {
    // Enrichment is asynchronous. A capture whose attachment is still pending
    // must hash exactly as it did at capture time, or every capture would
    // re-embed twice: once on arrival and once when nothing had changed.
    const pending = buildCanonicalInspirationEmbeddingInput({
      ...inspiration,
      attachments: [
        { type: "image" as const, enrichmentText: null },
        { type: "link" as const, enrichmentText: "   " },
      ],
    });
    expect(pending).toBe(buildCanonicalInspirationEmbeddingInput(inspiration));
  });

  it("orders its sections so the same capture always hashes the same", () => {
    expect(buildCanonicalInspirationEmbeddingInput(inspiration)).toBe(
      [
        "waka.inspiration_embedding_input.v1",
        "kind:note",
        "text:",
        inspiration.text,
        "attachments:",
        "none",
        "reflections:",
        "none",
      ].join("\n"),
    );
  });
});
