// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReflection } from "../src/lib/api";
import { ReflectionForm } from "../src/components/history/ReflectionForm";
import { ReflectionThread } from "../src/components/history/ReflectionThread";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    createReflection: vi.fn(async () => ({
      reflection: {
        id: "reflection-1",
        inspirationId: "insp-1",
        userId: "user-1",
        question: "질문",
        answer: "답변",
        skipped: false,
        createdAt: "2026-05-18T19:02:00.000Z",
      },
    })),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
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
  vi.clearAllMocks();
});

describe("reflection i18n rendering", () => {
  it("renders ReflectionForm placeholders, labels, validation, and controls in Korean", async () => {
    const view = await render(
      createElement(ReflectionForm, {
        inspirationId: "insp-1",
        locale: "ko-KR",
        autoFocus: false,
        onCancel: vi.fn(),
      }),
    );

    const question = view.querySelector<HTMLTextAreaElement>("textarea[aria-label='생각할 질문']");
    const answer = view.querySelector<HTMLTextAreaElement>("textarea[aria-label='답변']");
    expect(question?.placeholder).toBe("무엇이 궁금해지나요?");
    expect(answer?.placeholder).toBe("여기에 답변…");
    expect(view.textContent).toContain("이 생각 건너뛰기");
    expect(view.textContent).toContain("취소");
    expect(view.textContent).toContain("저장");
    expect(view.textContent).not.toMatch(/answer here|what does this make you ask|Skip|Cancel/);

    await act(async () => {
      view.querySelector<HTMLButtonElement>(".reflect-next")?.click();
    });

    expect(view.textContent).toContain("생각할 질문을 입력하세요.");
    expect(createReflection).not.toHaveBeenCalled();
  });

  it("renders ReflectionThread toggle and skipped copy in Korean", async () => {
    const view = await render(
      createElement(ReflectionThread, {
        locale: "ko-KR",
        open: false,
        onToggle: vi.fn(),
        entries: [
          {
            id: "reflection-1",
            question: "무엇이 먼저 마음에 걸렸나요?",
            answer: null,
            skipped: true,
          },
        ],
      }),
    );

    expect(view.textContent).toContain("생각 보기 · 1개 메모");
    expect(view.textContent).toContain("건너뜀 — 눌러서 답하기");
    expect(view.textContent).not.toMatch(/Show reflection|skipped — click to answer/);
  });
});
