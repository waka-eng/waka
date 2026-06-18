// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteInspiration, fetchReflections, updateInspiration } from "../src/lib/api";
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

async function renderDetail(options: { onNextInspiration?: () => void; locale?: "en-US" | "ko-KR"; onDeleted?: (id: string) => void } = {}): Promise<HTMLDivElement> {
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
        onDeleted: options.onDeleted,
        onNextInspiration: options.onNextInspiration,
        locale: options.locale,
      }),
    );
  });
  await flushReactWork();
  return container;
}

describe("InspirationDetail", () => {
  it("renders mockup-style source context and next navigation when a next row exists", async () => {
    const onNext = vi.fn();
    const container = await renderDetail({ onNextInspiration: onNext });

    expect(container.querySelector(".detail-view--mockup")).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>(".detail-media-image")?.src).toBe("https://example.com/preview.jpg");
    expect(container.textContent).toContain("A grounded source title");
    expect(container.textContent).toContain("Link");
    expect(container.textContent).toContain("https://example.com/watch?v=ambition");
    expect(container.textContent).toContain("Inspiration details");
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
        question: "What caught you first?",
        answer: "The north-facing window.",
        skipped: false,
        createdAt: "2026-05-18T19:02:00.000Z",
      },
      {
        id: "reflection-guided-2",
        inspirationId: "insp-1",
        userId: "user-1",
        question: "What does it make you want more of?",
        answer: "A quieter working cadence.",
        skipped: false,
        createdAt: "2026-05-18T19:03:00.000Z",
      },
      {
        id: "reflection-guided-3",
        inspirationId: "insp-1",
        userId: "user-1",
        question: "What is the next move?",
        answer: "Book one protected morning.",
        skipped: false,
        createdAt: "2026-05-18T19:04:00.000Z",
      },
    ]);

    const container = await renderDetail();

    expect(fetchReflections).toHaveBeenCalledWith("insp-1");
    expect(container.textContent).toContain("What caught you first?");
    expect(container.textContent).toContain("The north-facing window.");
    expect(container.textContent).toContain("A quieter working cadence.");
    expect(container.textContent).toContain("Book one protected morning.");
  });

  it("hides next navigation at the end of the list", async () => {
    const container = await renderDetail();
    expect(container.textContent).not.toContain("View next inspiration");
  });

  it("renders detail controls and reflection section labels in Korean", async () => {
    vi.mocked(fetchReflections).mockResolvedValueOnce([
      {
        id: "reflection-ko-1",
        inspirationId: "insp-1",
        userId: "user-1",
        question: "무엇이 먼저 마음에 걸렸나요?",
        answer: "북향 창문이요.",
        skipped: false,
        createdAt: "2026-05-18T19:02:00.000Z",
      },
    ]);

    const container = await renderDetail({
      locale: "ko-KR",
      onDeleted: vi.fn(),
      onNextInspiration: vi.fn(),
    });

    expect(container.querySelector<HTMLButtonElement>("#detailBack")?.textContent).toContain("뒤로");
    expect(container.querySelector<HTMLButtonElement>("#detailBack")?.getAttribute("aria-label")).toBe("저장된 영감으로 돌아가기");
    expect(container.textContent).toContain("저장됨 7:00 PM · 5/18/2026");
    expect(container.textContent).toContain("링크");
    expect(container.textContent).toContain("영감 상세");
    expect(container.textContent).toContain("내용 저장");
    expect(container.textContent).toContain("삭제");
    expect(container.textContent).toContain("조금 더 생각하기");
    expect(container.textContent).toContain("다음 영감 보기");
    expect(container.textContent).not.toMatch(/Back to saved signals|Highlights|Save details|Delete this|Reflect deeper|View next inspiration/);
  });

  it("renders the Korean reflection-load fallback without attachment preview copy", async () => {
    vi.mocked(fetchReflections).mockRejectedValueOnce("network-fallback");

    const container = await renderDetail({ locale: "ko-KR" });

    expect(container.textContent).toContain("생각을 불러오지 못했습니다.");
    expect(container.textContent).not.toContain("미리보기를 사용할 수 없습니다");
  });

  it("renders the Korean detail-save fallback without reflection-specific copy", async () => {
    vi.mocked(updateInspiration).mockRejectedValueOnce("network-fallback");
    const container = await renderDetail({ locale: "ko-KR" });
    const textarea = container.querySelector<HTMLTextAreaElement>("#inspirationDetailText");
    const form = container.querySelector<HTMLFormElement>(".detail-editor");
    expect(textarea).not.toBeNull();
    expect(form).not.toBeNull();

    await act(async () => {
      textarea!.value = "수정한 영감 상세";
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("내용을 저장하지 못했습니다.");
    expect(container.textContent).not.toContain("생각을 저장하지 못했습니다.");
  });

  it("renders the Korean delete fallback without attachment preview copy", async () => {
    vi.mocked(deleteInspiration).mockRejectedValueOnce("network-fallback");
    const container = await renderDetail({ locale: "ko-KR", onDeleted: vi.fn() });
    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "삭제",
    );
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton!.click();
    });
    const confirmButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent === "삭제 확인",
    );
    expect(confirmButton).not.toBeNull();
    await act(async () => {
      confirmButton!.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("영감을 삭제하지 못했습니다.");
    expect(container.textContent).not.toContain("미리보기를 사용할 수 없습니다");
  });

});
