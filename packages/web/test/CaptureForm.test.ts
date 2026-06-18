// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInspiration,
  createReflection,
  finalizeAttachment,
  generateGuidedReflectionQuestion,
  ApiError,
  presignAttachment,
  uploadToPresignedUrl,
  type ApiInspiration,
} from "../src/lib/api";
import { CaptureForm } from "../src/components/capture/CaptureForm";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    createInspiration: vi.fn(),
    createReflection: vi.fn(),
    finalizeAttachment: vi.fn(),
    generateGuidedReflectionQuestion: vi.fn(),
    presignAttachment: vi.fn(),
    uploadToPresignedUrl: vi.fn(),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function inspiration(overrides: Partial<ApiInspiration> = {}): ApiInspiration {
  return {
    id: "insp-new",
    userId: "user-1",
    text: "Saved inspiration",
    kind: "note",
    category: null,
    importanceScore: 0,
    wowScore: 0,
    cluster: null,
    classifiedAt: null,
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:00:00.000Z",
    ...overrides,
  };
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushDraftAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function renderCaptureForm(props: ComponentProps<typeof CaptureForm> = {}): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(CaptureForm, props));
  });
  return container;
}

function setText(value: string): void {
  const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
  expect(textarea).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea?.dispatchEvent(new Event("input", { bubbles: true }));
}

function setReflectText(value: string): void {
  const textarea = container?.querySelector<HTMLTextAreaElement>("#reflectAns");
  expect(textarea).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea?.dispatchEvent(new Event("input", { bubbles: true }));
}


async function pressMetaEnter(): Promise<void> {
  const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
  expect(textarea).not.toBeNull();
  await act(async () => {
    textarea?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
  });
  await flushReactWork();
}

async function pasteText(value: string): Promise<void> {
  const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
  expect(textarea).not.toBeNull();
  const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  event.clipboardData = { getData: (type: string) => (type === "text" || type === "text/plain" ? value : "") };
  await act(async () => {
    textarea?.dispatchEvent(event);
  });
}

async function clickQuickSave(): Promise<void> {
  const button = container?.querySelector<HTMLButtonElement>("#capSave");
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
  });
  await flushReactWork();
  await flushReactWork();
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(createInspiration).mockResolvedValue(inspiration());
  vi.mocked(createReflection).mockResolvedValue({
    reflection: {
      id: "reflection-1",
      inspirationId: "insp-new",
      userId: "user-1",
      question: "What did this mean to you?",
      answer: "It matters.",
      skipped: false,
      createdAt: "2026-05-27T12:01:00.000Z",
    },
  });
  vi.mocked(generateGuidedReflectionQuestion).mockResolvedValue({
    question: "What first caught you here — the idea, feeling, person, or possibility?",
    source: "fallback",
    fallbackReason: "no_model_config",
  });
  vi.mocked(presignAttachment).mockResolvedValue({
    uploadUrl: "https://s3.example/upload",
    key: "uploads/user-1/photo.png",
    expiresAt: "2026-05-27T12:05:00.000Z",
    headers: {
      "Content-Type": "image/png",
      "Content-Length": "4",
    },
  });
  vi.mocked(uploadToPresignedUrl).mockResolvedValue(undefined);
  vi.mocked(finalizeAttachment).mockResolvedValue({
    id: "att-1",
    inspirationId: "insp-new",
    type: "link",
    url: "https://example.com/article",
    name: "example.com/article",
    s3Key: null,
    contentType: null,
    size: null,
    createdAt: "2026-05-27T12:00:01.000Z",
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(() => undefined),
  });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("CaptureForm responsive CTA CSS", () => {
  it("keeps modal quick-save CTAs and guided Reflect Deeper controls inside the modal card", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toMatch(/\.cap-save\s*\{[\s\S]*?opacity:\s*0;/);
    expect(css).toMatch(
      /\.cap-save\.visible,\s*\.reference-capture-modal \.cap-save\.visible\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/,
    );
    expect(css).toMatch(/\.reference-capture-modal \.cap-body,\s*\.reference-capture-modal \.reflect-area\s*\{/);
    expect(css).toMatch(/\.reference-capture-modal \.reflect-bar\.visible\s*\{[\s\S]*?display:\s*flex;[\s\S]*?margin-top:\s*16px;/);
  });
});

describe("CaptureForm multi-input quick capture", () => {
  it("opens as a private blank-page capture ritual", async () => {
    await renderCaptureForm();

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.placeholder).toBe(
      "What almost slipped away?",
    );
    expect(container?.querySelector("#capResonance")).toBeNull();
    expect(container?.querySelector("#capDraftState")?.textContent).toContain("Tip: highlight what inspired you.");
    expect(container?.querySelector<HTMLButtonElement>("#capSave")?.textContent).toContain("Save it now");
    expect(container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.textContent).toContain("Reflect deeper");
    expect(container?.textContent?.toLowerCase()).not.toMatch(
      /\bsignals?\b|\bmemories\b|\bgraph\b|\bnodes?\b|memory movement|\bresonance\b|\banalysis\b|\bAI\b/,
    );
  });

  it("autosaves draft text locally and restores it on the next mount", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("A private draft that should not disappear");
    });
    await flushReactWork();
    await flushDraftAutosave();

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;

    await renderCaptureForm();

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe(
      "A private draft that should not disappear",
    );
    expect(container?.querySelector("#capDraftState")?.textContent).toContain("Tip: highlight what inspired you.");
  });

  it("drops expired local capture drafts instead of restoring sensitive text indefinitely", async () => {
    window.localStorage.setItem(
      "waka.captureDraft.v1",
      JSON.stringify({
        note: "An old private draft",
        storedAt: Date.now() - 25 * 60 * 60 * 1000,
      }),
    );

    await renderCaptureForm();

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("");
    expect(window.localStorage.getItem("waka.captureDraft.v1")).toBeNull();
  });

  it("persists marked text and the small why-it-mattered answer as spark metadata", async () => {
    const onSaved = vi.fn();
    await renderCaptureForm({ onSaved });
    await act(async () => {
      setText("I keep returning to studios with huge north-facing windows");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    expect(textarea).not.toBeNull();
    await act(async () => {
      textarea?.setSelectionRange(20, 58);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const selectionToolbar = container?.querySelector<HTMLElement>(".cap-selection-toolbar");
    expect(selectionToolbar?.textContent).toContain("highlight");
    expect(selectionToolbar?.querySelector("button")?.getAttribute("aria-label")).toBe("Highlight selected text");
    expect(selectionToolbar?.querySelector("button")?.getAttribute("title")).toBe("Highlight selected text");
    expect(selectionToolbar?.style.getPropertyValue("--highlight-top")).not.toBe("");
    await act(async () => {
      selectionToolbar?.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(container?.querySelector(".cap-note-highlight-layer mark")?.childNodes[0]?.textContent).toBe(
      "studios with huge north-facing windows",
    );

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "I keep returning to studios with huge north-facing windows",
      kind: "note",
      sparks: [
        {
          text: "studios with huge north-facing windows",
          source: "user_selected",
          startOffset: 20,
          endOffset: 58,
          confidence: 100,
          isPrimary: true,
          note: undefined,
        },
      ],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
    expect(window.localStorage.getItem("waka.captureDraft.v1")).toBeNull();
  });

  it("localizes the active selection toolbar copy in Korean", async () => {
    await renderCaptureForm({ locale: "ko-KR" });
    await act(async () => {
      setText("북향 창이 큰 작업실이 계속 떠오른다");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    expect(textarea).not.toBeNull();
    await act(async () => {
      textarea?.setSelectionRange(0, 7);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const selectionToolbar = container?.querySelector<HTMLElement>(".cap-selection-toolbar");
    const selectionButton = selectionToolbar?.querySelector<HTMLButtonElement>("button");
    expect(selectionToolbar).not.toBeNull();
    expect(selectionButton?.getAttribute("aria-label")).toBe("선택한 텍스트 표시");
    expect(selectionButton?.getAttribute("title")).toBe("선택한 텍스트 표시");
    expect(selectionButton?.textContent).toContain("표시");
    expect(selectionButton?.textContent).not.toContain("highlight");
    expect(selectionButton?.getAttribute("aria-label")).not.toBe("highlight selected text");
  });

  it("supports multiple explicit highlights without blocking save", async () => {
    const onSaved = vi.fn();
    await renderCaptureForm({ onSaved });
    await act(async () => {
      setText("This scared me because it feels high stakes");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      textarea?.setSelectionRange(0, "This scared me".length);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".cap-selection-toolbar button")?.click();
    });
    await act(async () => {
      textarea?.setSelectionRange("This scared me because it ".length, "This scared me because it feels high stakes".length);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".cap-selection-toolbar button")?.click();
    });
    expect(container?.querySelectorAll(".cap-note-highlight-layer mark")).toHaveLength(2);

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "This scared me because it feels high stakes",
      kind: "note",
      sparks: [
        {
          text: "This scared me",
          source: "user_selected",
          startOffset: 0,
          endOffset: 14,
          confidence: 100,
          isPrimary: true,
          note: undefined,
        },
        {
          text: "feels high stakes",
          source: "user_selected",
          startOffset: 26,
          endOffset: 43,
          confidence: 100,
          isPrimary: false,
          note: undefined,
        },
      ],
    });
    expect(createReflection).not.toHaveBeenCalled();
    // On a full save the in-cell mirror is gone; the parent is signalled to
    // close the surface and flash the capture button instead.
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
  });

  it("creates an inline highlight only after clicking the small selection toolbar", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("The quiet studio standards pulled me back");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      textarea?.setSelectionRange(10, 26);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const selectionToolbar = container?.querySelector<HTMLElement>(".cap-selection-toolbar");
    expect(selectionToolbar).not.toBeNull();
    expect(selectionToolbar?.style.getPropertyValue("--highlight-top")).not.toBe("");
    expect(container?.querySelector(".cap-note-highlight-layer mark")).toBeNull();
    await act(async () => {
      selectionToolbar?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(container?.querySelector(".cap-note-highlight-layer mark")?.childNodes[0]?.textContent).toBe("studio standards");
    expect(container?.querySelector(".cap-highlight-row")).toBeNull();

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "The quiet studio standards pulled me back",
      kind: "note",
      sparks: [
        {
          text: "studio standards",
          source: "user_selected",
          startOffset: 10,
          endOffset: 26,
          confidence: 100,
          isPrimary: true,
          note: undefined,
        },
      ],
    });
  });

  it("keeps highlight editing next to the highlighted text instead of a detached list", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("The part that hit was the open studio table");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      textarea?.setSelectionRange(26, 43);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".cap-selection-toolbar button")?.click();
    });

    const mark = container?.querySelector<HTMLElement>(".cap-note-highlight-layer mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toContain("open studio table");
    expect(container?.querySelector(".cap-highlight-row")).toBeNull();
    expect(container?.querySelector("#capHighlightState")).toBeNull();
    expect(container?.querySelector(".cap-resonance--popover")).toBeNull();

    await act(async () => {
      mark?.querySelector<HTMLButtonElement>(".cap-unhighlight")?.click();
    });
    expect(container?.querySelector(".cap-note-highlight-layer mark")).toBeNull();
    expect(container?.querySelector(".cap-selection-toolbar")).toBeNull();
  });

  it("expands into a full-page writing environment without losing draft highlights", async () => {
    // The expand/collapse control sits with the attach button on the left of
    // the capture bar; toggling it asks the parent to flip focus mode, and the
    // cell preserves draft + highlights across the transition.
    const toggleFocus = vi.fn();
    const { rerender } = await (async () => {
      await renderCaptureForm({ focused: false, onToggleFocus: toggleFocus });
      return {
        rerender: async (focused: boolean) => {
          await act(async () => {
            root?.render(createElement(CaptureForm, { focused, onToggleFocus: toggleFocus }));
          });
        },
      };
    })();
    await act(async () => {
      setText("Keep the open studio table safe");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      textarea?.setSelectionRange(9, 26);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".cap-selection-toolbar button")?.click();
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capExpand")?.click();
    });
    expect(toggleFocus).toHaveBeenCalledWith(true);
    await rerender(true);
    expect(container?.querySelector(".cell.capture")?.className).toContain("focused");
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("Keep the open studio table safe");
    expect(container?.querySelector(".cap-note-highlight-layer mark")?.childNodes[0]?.textContent).toBe("open studio table");

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capExpand")?.click();
    });
    expect(toggleFocus).toHaveBeenLastCalledWith(false);
    await rerender(false);
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("Keep the open studio table safe");
    expect(container?.querySelector(".cap-note-highlight-layer mark")?.childNodes[0]?.textContent).toBe("open studio table");
  });

  it("signals the parent to close and flash after a quick save instead of showing a mirror", async () => {
    const onSaved = vi.fn();
    await renderCaptureForm({ onSaved });
    await act(async () => {
      setText("This private weather needs one more pass");
    });

    await clickQuickSave();

    // No in-cell post-save mirror; the parent handles the close + "saved" flash.
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    // The note is cleared so a fresh capture can start.
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("");
  });

  it("attaches one ordered adaptive guided reflection after three LLM-guided questions", async () => {
    vi.mocked(createInspiration).mockResolvedValue(inspiration({ id: "insp-post-save" }));
    vi.mocked(generateGuidedReflectionQuestion)
      .mockResolvedValueOnce({ question: "What private weather does this signal name?", source: "model" })
      .mockResolvedValueOnce({ question: "What would protecting that weather ask you to change?", source: "model" })
      .mockResolvedValueOnce({ question: "What is one small room-temperature experiment for tomorrow?", source: "model" });
    const onSaved = vi.fn();
    await renderCaptureForm({ onSaved });
    await act(async () => {
      setText("A messy thing I want safe before I understand it");
    });

    // "Reflect deeper" opens the guided reflection view before committing the save.
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.click();
    });
    await flushReactWork();
    expect(container?.querySelector("#reflectArea")?.className).toContain("visible");
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("Reflect Deeper in progress");
    expect(container?.querySelector("#capBar")).toBeNull();
    expect(container?.querySelector("#capSave")).toBeNull();
    expect(container?.querySelector("#capReflectiveSave")).toBeNull();
    expect(container?.querySelector("#reflectArea")?.contains(container?.querySelector("#reflectBar") ?? null)).toBe(true);
    expect(container?.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Back");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Continue");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).not.toContain("Save");
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What private weather does this signal name?");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 1 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    expect(generateGuidedReflectionQuestion).toHaveBeenCalledWith({
      locale: "en-US",
      inspiration: {
        text: "A messy thing I want safe before I understand it",
        kind: "note",
        links: [],
        attachmentKinds: [],
        highlights: [],
        resonance: null,
        resonanceNote: "",
      },
      priorAnswers: [],
    });
    expect(createInspiration).not.toHaveBeenCalled();

    await act(async () => {
      setReflectText("The feeling of wanting to protect it.");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What would protecting that weather ask you to change?");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 2 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("2");
    expect(container?.querySelector("#capBar")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Back");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Continue");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).not.toContain("Save");
    expect(generateGuidedReflectionQuestion).toHaveBeenLastCalledWith(expect.objectContaining({
      priorAnswers: [
        {
          question: "What private weather does this signal name?",
          answer: "The feeling of wanting to protect it.",
        },
      ],
    }));
    expect(createInspiration).not.toHaveBeenCalled();

    await act(async () => {
      setReflectText("More quiet studio time.");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("one small room-temperature experiment");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 3 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("3");
    expect(container?.querySelector("#capBar")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Back");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Save reflection");
    expect(createInspiration).not.toHaveBeenCalled();

    await act(async () => {
      setReflectText("Book one hour tomorrow.");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();

    expect(createInspiration).toHaveBeenCalledTimes(1);
    expect(createInspiration).toHaveBeenCalledWith({
      text: "A messy thing I want safe before I understand it",
      kind: "note",
      reflections: [
        {
          question: "What private weather does this signal name?",
          answer: "The feeling of wanting to protect it.",
          skipped: false,
        },
        {
          question: "What would protecting that weather ask you to change?",
          answer: "More quiet studio time.",
          skipped: false,
        },
        {
          question: "What is one small room-temperature experiment for tomorrow?",
          answer: "Book one hour tomorrow.",
          skipped: false,
        },
      ],
    });
    expect(createReflection).not.toHaveBeenCalled();
    // No mirror card — the parent is signalled to close and flash "saved".
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("persists a selected passage as user-selected spark metadata", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("I want to build toward this operating cadence");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      textarea?.setSelectionRange(0, "I want to build toward this".length);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".cap-selection-toolbar button")?.click();
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "I want to build toward this operating cadence",
      kind: "note",
      sparks: [
        {
          text: "I want to build toward this",
          source: "user_selected",
          startOffset: 0,
          endOffset: 27,
          confidence: 100,
          isPrimary: true,
          note: undefined,
        },
      ],
    });
  });

  it("keeps the draft intact when server save fails", async () => {
    vi.mocked(createInspiration).mockRejectedValueOnce(
      new ApiError({ status: 500, message: "save failed" }),
    );
    await renderCaptureForm();
    await act(async () => {
      setText("Do not clear this draft");
    });
    await flushDraftAutosave();

    await clickQuickSave();

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("Do not clear this draft");
    expect(window.localStorage.getItem("waka.captureDraft.v1")).toContain("Do not clear this draft");
  });

  it("gently prompts instead of saving when the empty composer is invoked from the keyboard", async () => {
    await renderCaptureForm();

    await pressMetaEnter();

    expect(createInspiration).not.toHaveBeenCalled();
    expect(container?.querySelector("#capConfirm")?.textContent).toContain(
      "Add what hit: a note, link, or image to save.",
    );
  });

  it("turns a pasted URL-only input into a removable link chip without duplicating raw text", async () => {
    await renderCaptureForm();

    await pasteText("https://example.com/article");

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("");
    expect(container?.querySelector(".att-url")?.textContent).toBe("Link · example.com/article");
    expect(container?.querySelector<HTMLButtonElement>("#capSave")?.disabled).toBe(false);
  });

  it("localizes capture action tooltips, tip copy, and removable chip labels in Korean", async () => {
    await renderCaptureForm({ locale: "ko-KR" });
    await pasteText("https://example.com/article");

    expect(container?.querySelector("#capDraftState")?.textContent).toContain("팁: 마음을 움직인 부분을 표시하세요.");
    expect(container?.querySelector("#capDraftState")?.textContent).not.toContain("Tip: highlight what inspired you.");
    expect(container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.title).toBe(
      "이 영감을 저장하기 전에 짧은 생각 하나 더하기",
    );
    expect(container?.querySelector<HTMLButtonElement>("#capSave")?.title).toBe("이 영감을 지금 저장");
    expect(container?.querySelector<HTMLButtonElement>(".att-x")?.getAttribute("aria-label")).toBe("첨부 제거");
  });

  it("quick saves a plain note as kind note without opening reflection", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("A plain idea worth saving");
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "A plain idea worth saving",
      kind: "note",
    });
    expect(createReflection).not.toHaveBeenCalled();
    expect(container?.querySelector("#reflectArea")?.className).not.toContain("visible");
  });

  it("quick saves a typed URL as kind link and finalizes a link attachment", async () => {
    vi.mocked(createInspiration).mockResolvedValue(inspiration({ kind: "link", text: "https://example.com/article" }));
    await renderCaptureForm();
    await act(async () => {
      setText("https://example.com/article");
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "https://example.com/article",
      kind: "link",
    });
    expect(finalizeAttachment).toHaveBeenCalledWith({
      type: "link",
      inspirationId: "insp-new",
      url: "https://example.com/article",
      name: "example.com/article",
    });
    expect(createReflection).not.toHaveBeenCalled();
  });

  it("dedupes a pasted link chip against the same typed note URL at save time", async () => {
    vi.mocked(createInspiration).mockResolvedValue(
      inspiration({ kind: "mixed", text: "Remember this https://example.com/article" }),
    );
    await renderCaptureForm();
    await pasteText("https://example.com/article");
    await act(async () => {
      setText("Remember this https://example.com/article");
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Remember this https://example.com/article",
      kind: "mixed",
    });
    expect(finalizeAttachment).toHaveBeenCalledTimes(1);
    expect(finalizeAttachment).toHaveBeenCalledWith({
      type: "link",
      inspirationId: "insp-new",
      url: "https://example.com/article",
      name: "Link · example.com/article",
    });
  });

  it("quick saves an attachment-only image as kind image through the existing upload/finalize path", async () => {
    vi.mocked(createInspiration).mockResolvedValue(
      inspiration({ kind: "image", text: "Image inspiration" }),
    );
    vi.mocked(finalizeAttachment).mockResolvedValue({
      id: "att-image",
      inspirationId: "insp-new",
      type: "image",
      url: "https://cdn.example/photo.png",
      name: "photo.png",
      s3Key: "uploads/user-1/photo.png",
      contentType: "image/png",
      size: 4,
      createdAt: "2026-05-27T12:00:01.000Z",
    });
    await renderCaptureForm();
    const input = container?.querySelector<HTMLInputElement>("#capFile");
    expect(input).not.toBeNull();
    const file = new File(["data"], "photo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Image inspiration",
      kind: "image",
    });
    expect(presignAttachment).toHaveBeenCalledWith({
      filename: "photo.png",
      contentType: "image/png",
      size: 4,
    });
    expect(uploadToPresignedUrl).toHaveBeenCalledWith("https://s3.example/upload", file, {
      "Content-Type": "image/png",
      "Content-Length": "4",
    });
    expect(finalizeAttachment).toHaveBeenCalledWith({
      type: "image",
      inspirationId: "insp-new",
      key: "uploads/user-1/photo.png",
      name: "photo.png",
      contentType: "image/png",
      size: 4,
    });
    expect(createReflection).not.toHaveBeenCalled();
  });

  it("rejects unsupported files with friendly copy before creating rows", async () => {
    await renderCaptureForm();
    const input = container?.querySelector<HTMLInputElement>("#capFile");
    expect(input).not.toBeNull();
    const file = new File(["data"], "notes.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clickQuickSave();

    expect(createInspiration).not.toHaveBeenCalled();
    expect(container?.querySelector("#capConfirm")?.textContent).toContain("This image is too large or not supported.");
  });

  it("keeps the saved inspiration and reports recovery copy when attachment finalization partially fails", async () => {
    vi.mocked(createInspiration).mockResolvedValue(inspiration({ kind: "link", text: "Link inspiration" }));
    vi.mocked(finalizeAttachment).mockRejectedValueOnce(new ApiError({ status: 500, message: "upload failed" }));
    const onPersisted = vi.fn();
    await renderCaptureForm({ onPersisted });
    await pasteText("https://example.com/article");

    await clickQuickSave();

    expect(onPersisted).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ failedAttachments: [expect.objectContaining({ localId: expect.any(String) })] }),
    );
    expect(container?.querySelector("#capConfirm")?.textContent).toContain(
      "Saved — 1 attachment failed. Your inspiration is still safe.",
    );
  });

  it("quick saves mixed note and URL input as kind mixed while finalizing the link", async () => {
    vi.mocked(createInspiration).mockResolvedValue(
      inspiration({ kind: "mixed", text: "Remember this https://example.com/image.png" }),
    );
    await renderCaptureForm();
    await act(async () => {
      setText("Remember this https://example.com/image.png");
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Remember this https://example.com/image.png",
      kind: "mixed",
    });
    expect(finalizeAttachment).toHaveBeenCalledWith({
      type: "link",
      inspirationId: "insp-new",
      url: "https://example.com/image.png",
      name: "example.com/image.png",
    });
    expect(createReflection).not.toHaveBeenCalled();
  });
});

describe("CaptureForm Reflect Deeper journey", () => {
  it("shows an animation-only loading state for the first adaptive question", async () => {
    const firstQuestion = deferred<Awaited<ReturnType<typeof generateGuidedReflectionQuestion>>>();
    vi.mocked(generateGuidedReflectionQuestion).mockReturnValueOnce(firstQuestion.promise);
    await renderCaptureForm();
    expect(container?.textContent).not.toContain("What caught you first");
    await act(async () => {
      setText("A room-temperature clue I do not want to lose");
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.click();
    });

    expect(container?.querySelector("#reflectArea")?.className).toContain("visible");
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("Finding a question that fits…");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("What caught you first");
    expect(container?.querySelector(".reflect-question-spinner")).not.toBeNull();
    expect(container?.querySelector(".reflect-kicker")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.disabled).toBe(true);
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");

    await act(async () => {
      firstQuestion.resolve({ question: "What private weather does this signal name?", source: "model" });
      await firstQuestion.promise;
    });

    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What private weather does this signal name?");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("What caught you first");
    expect(container?.querySelector(".reflect-question-loading")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.disabled).toBe(false);
  });

  it("waits for the next adaptive question instead of swapping a fallback under the user", async () => {
    const secondQuestion = deferred<Awaited<ReturnType<typeof generateGuidedReflectionQuestion>>>();
    vi.mocked(generateGuidedReflectionQuestion)
      .mockResolvedValueOnce({ question: "What private weather does this signal name?", source: "model" })
      .mockReturnValueOnce(secondQuestion.promise);
    await renderCaptureForm();
    await act(async () => {
      setText("Another clue that should keep its question stable");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.click();
    });
    await flushReactWork();
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What private weather does this signal name?");

    await act(async () => {
      setReflectText("It feels like a threshold.");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });

    expect(container?.querySelector("#reflectQ")?.textContent).toContain("Finding a question that fits…");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("What does it make you want more of");
    expect(container?.querySelector(".reflect-question-spinner")).not.toBeNull();
    expect(container?.querySelector(".reflect-kicker")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.disabled).toBe(true);
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("2");

    await act(async () => {
      secondQuestion.resolve({ question: "What would protecting that weather ask you to change?", source: "model" });
      await secondQuestion.promise;
    });

    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What would protecting that weather ask you to change?");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("What does it make you want more of");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.disabled).toBe(false);
    await act(async () => {
      setReflectText("Keep Friday quiet.");
    });
    await flushReactWork();
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What would protecting that weather ask you to change?");
  });

  it("falls back to the local question only when adaptive generation fails", async () => {
    const failedQuestion = deferred<Awaited<ReturnType<typeof generateGuidedReflectionQuestion>>>();
    vi.mocked(generateGuidedReflectionQuestion).mockReturnValueOnce(failedQuestion.promise);
    await renderCaptureForm();
    await act(async () => {
      setText("A fallback should be stable only after failure");
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.click();
    });
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("Finding a question that fits…");
    expect(container?.querySelector(".reflect-question-spinner")).not.toBeNull();
    expect(container?.querySelector(".reflect-kicker")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.disabled).toBe(true);
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("What caught you first");

    await act(async () => {
      failedQuestion.reject(new Error("model unavailable"));
      await failedQuestion.promise.catch(() => undefined);
    });

    expect(container?.querySelector("#reflectQ")?.textContent).toContain("What caught you first");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.disabled).toBe(false);
  });

  it("blocks blank steps, supports back, and saves after the final guided answer", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("Process this richer input");
    });

    const processButton = container?.querySelector<HTMLButtonElement>("#capReflectiveSave");
    await act(async () => {
      processButton?.click();
    });
    await flushReactWork();

    expect(createInspiration).not.toHaveBeenCalled();
    expect(container?.querySelector("#reflectArea")?.className).toContain("visible");
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 1 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");

    const continueButton = container?.querySelector<HTMLButtonElement>("#reflectNext");
    await act(async () => {
      continueButton?.click();
    });
    expect(createInspiration).not.toHaveBeenCalled();
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 1 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    expect(container?.querySelector("#capConfirm")?.textContent).toContain("Add a few words to keep going");

    await act(async () => {
      setReflectText("It connects to the next project.");
    });
    await act(async () => {
      continueButton?.click();
    });
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 2 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("2");

    await act(async () => {
      setReflectText("A protected weekly making block.");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectLater")?.click();
    });
    expect(container?.querySelector("#reflectQ")?.textContent).not.toContain("Step 1 of 3");
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
    expect(container?.querySelector<HTMLTextAreaElement>("#reflectAns")?.value).toBe("It connects to the next project.");

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectLater")?.click();
    });
    expect(container?.querySelector("#reflectArea")?.className).not.toContain("visible");
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("Process this richer input");

    await act(async () => {
      processButton?.click();
    });
    await act(async () => {
      setReflectText("It connects to the next project.");
    });
    await act(async () => {
      continueButton?.click();
    });
    await act(async () => {
      setReflectText("A protected weekly making block.");
    });
    await act(async () => {
      continueButton?.click();
    });
    await act(async () => {
      setReflectText("Schedule Friday morning.");
    });
    await act(async () => {
      continueButton?.click();
    });
    await flushReactWork();
    await flushReactWork();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Process this richer input",
      kind: "note",
      reflections: [
        {
          question: "What first caught you here — the idea, feeling, person, or possibility?",
          answer: "It connects to the next project.",
          skipped: false,
        },
        {
          question: "What first caught you here — the idea, feeling, person, or possibility?",
          answer: "A protected weekly making block.",
          skipped: false,
        },
        {
          question: "What first caught you here — the idea, feeling, person, or possibility?",
          answer: "Schedule Friday morning.",
          skipped: false,
        },
      ],
    });
    expect(createReflection).not.toHaveBeenCalled();
  });
});
