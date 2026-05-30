// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { InspirationCard, type InspirationCardData } from "../src/components/InspirationCard";
import type { SupportedLocale } from "../src/lib/locales";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderCard(item: InspirationCardData, locale?: SupportedLocale): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(InspirationCard, { item, locale }));
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe("InspirationCard attachment-first rendering", () => {
  it("leads URL-only saved signals with link context instead of fallback text", async () => {
    await renderCard({
      id: "insp-link",
      text: "Link signal",
      kind: "link",
      timestamp: "12:00 PM · 5/28/2026",
      links: ["https://example.com/article"],
      attachments: [
        {
          id: "att-link",
          inspirationId: "insp-link",
          type: "link",
          url: "https://example.com/article",
          name: "example.com/article",
          contentType: null,
          size: null,
          createdAt: "2026-05-28T12:00:00.000Z",
          enrichment: {
            status: "ready",
            source: "url",
            sourceUrl: "https://example.com/article",
            errorReason: null,
            checkedAt: "2026-05-28T12:00:00.000Z",
            link: {
              originalUrl: "https://example.com/article",
              finalUrl: "https://example.com/article",
              hostname: "example.com",
              title: "Example Article",
              description: "A useful read",
              siteName: "Example",
              previewImageUrl: null,
            },
            image: null,
          },
        },
      ],
    });

    expect(container?.querySelector(".history-item-text")).toBeNull();
    expect(container?.querySelector(".history-attachment-title")?.textContent).toBe("Example Article");
    expect(container?.textContent).not.toContain("LINK");
  });

  it("leads image-only saved signals with image context instead of fallback text", async () => {
    await renderCard({
      id: "insp-image",
      text: "Image signal",
      kind: "image",
      timestamp: "12:00 PM · 5/28/2026",
      links: null,
      attachments: [
        {
          id: "att-image",
          inspirationId: "insp-image",
          type: "image",
          name: "photo.png",
          contentType: "image/png",
          size: 2048,
          createdAt: "2026-05-28T12:00:00.000Z",
          enrichment: {
            status: "ready",
            source: "user_upload",
            sourceUrl: null,
            errorReason: null,
            checkedAt: "2026-05-28T12:00:00.000Z",
            link: null,
            image: {
              filename: "photo.png",
              contentType: "image/png",
              size: 2048,
              width: null,
              height: null,
            },
          },
        },
      ],
    });

    expect(container?.querySelector(".history-item-text")).toBeNull();
    expect(container?.querySelector(".history-attachment-title")?.textContent).toBe("photo.png");
    expect(container?.textContent).not.toContain("IMAGE");
    expect(container?.textContent).not.toContain("(attachment-only inspiration)");
  });

  it("localizes attachment context copy for Korean history cards", async () => {
    await renderCard(
      {
        id: "insp-ko-link",
        text: "Link signal",
        kind: "link",
        links: ["https://example.com/article"],
        attachments: [
          {
            id: "att-ko-link",
            inspirationId: "insp-ko-link",
            type: "link",
            url: "https://example.com/article",
            name: "example.com/article",
            contentType: null,
            size: null,
            createdAt: "2026-05-28T12:00:00.000Z",
            enrichment: null,
          },
        ],
      },
      "ko-KR",
    );

    expect(container?.querySelector(".history-attachments")?.getAttribute("aria-label")).toBe("첨부 맥락");
  });
});
