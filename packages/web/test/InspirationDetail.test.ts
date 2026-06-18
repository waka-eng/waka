// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchReflections } from "../src/lib/api";
import { InspirationDetail } from "../src/components/history/InspirationDetail";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    updateInspiration: vi.fn(async () => {
      throw new Error("updateInspiration mock not configured");
    }),
    fetchReflections: vi.fn(async () => []),
    deleteInspiration: vi.fn(async () => undefined),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  vi.clearAllMocks();
  vi.mocked(fetchReflections).mockResolvedValue([]);
});

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderDetail(onNextInspiration?: () => void): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(
      createElement(InspirationDetail, {
        inspiration: {
          id: "insp-1",
          text: "A saved signal about how ambition becomes concrete when there is a visible next move.",
          links: ["https://example.com/watch?v=ambition"],
          timestamp: "7:00 PM · 5/18/2026",
          attachments: [
            {
              id: "att-1",
              inspirationId: "insp-1",
              type: "link",
              url: "https://example.com/watch?v=ambition",
              name: "example.com/watch",
              contentType: null,
              size: null,
              createdAt: "2026-05-18T19:00:00.000Z",
              enrichment: {
                status: "ready",
                source: "url",
                sourceUrl: "https://example.com/watch?v=ambition",
                errorReason: null,
                checkedAt: "2026-05-18T19:00:01.000Z",
                link: {
                  originalUrl: "https://example.com/watch?v=ambition",
                  finalUrl: "https://example.com/watch?v=ambition",
                  hostname: "example.com",
                  title: "A grounded source title",
                  description: "A real preview description from link metadata.",
                  siteName: null,
                  previewImageUrl: "https://example.com/preview.jpg",
                },
                image: null,
              },
            },
          ],
        },
        onBack: vi.fn(),
        onNextInspiration,
      }),
    );
  });
  await flushReactWork();
  return container;
}

describe("InspirationDetail", () => {
  it("renders mockup-style source context and next navigation when a next row exists", async () => {
    const onNext = vi.fn();
    const container = await renderDetail(onNext);

    expect(container.querySelector(".detail-view--mockup")).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>(".detail-media-image")?.src).toBe("https://example.com/preview.jpg");
    expect(container.textContent).toContain("A grounded source title");
    expect(container.textContent).toContain("Link");
    expect(container.textContent).toContain("https://example.com/watch?v=ambition");
    expect(container.textContent).toContain("Highlights");
    expect(container.textContent).not.toContain("Source links");
    expect(container.textContent).not.toContain("Add context");
    expect(container.textContent).not.toContain("No reflections yet.");

    const next = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("View next inspiration"),
    );
    expect(next).not.toBeNull();
    await act(async () => {
      next?.click();
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("renders saved Reflect Deeper responses fetched for the selected inspiration", async () => {
    vi.mocked(fetchReflections).mockResolvedValueOnce([
      {
        id: "reflection-guided-1",
        inspirationId: "insp-1",
        userId: "user-1",
        question: "Reflect deeper guided reflection",
        answer: [
          "What caught you first?\nThe north-facing window.",
          "What does it make you want more of?\nA quieter working cadence.",
          "What is the next move?\nBook one protected morning.",
        ].join("\n\n"),
        skipped: false,
        createdAt: "2026-05-18T19:02:00.000Z",
      },
    ]);

    const container = await renderDetail();

    expect(fetchReflections).toHaveBeenCalledWith("insp-1");
    expect(container.textContent).toContain("Reflect deeper guided reflection");
    expect(container.textContent).toContain("The north-facing window.");
    expect(container.textContent).toContain("Book one protected morning.");
  });

  it("hides next navigation at the end of the list", async () => {
    const container = await renderDetail();
    expect(container.textContent).not.toContain("View next inspiration");
  });
});
