// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInspiration,
  createReflection,
  finalizeAttachment,
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
  it("keeps modal quick-save CTAs visible when the populated state adds visible", () => {
    const css = readFileSync("src/styles/global.css", "utf8");

    expect(css).toMatch(/\.cap-save\s*\{[\s\S]*?opacity:\s*0;/);
    expect(css).toMatch(
      /\.cap-save\.visible,\s*\.reference-capture-modal \.cap-save\.visible\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/,
    );
  });
});

describe("CaptureForm multi-input quick capture", () => {
  it("opens as a private blank-page capture ritual", async () => {
    await renderCaptureForm();

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.placeholder).toBe(
      "What almost slipped away?",
    );
    expect(container?.querySelector("#capResonance")?.textContent).toContain("What pull does it have?");
    expect(container?.querySelector("#capResonance")?.textContent).toContain("I want people like this");
    expect(container?.querySelector("#capResonance")?.textContent).toContain("I don't know yet");
  });

  it("autosaves draft text locally and restores it on the next mount", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("A private draft that should not disappear");
    });
    await flushReactWork();

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
    expect(container?.querySelector("#capDraftState")?.textContent).toContain("Private draft autosaved locally");
  });

  it("persists marked text and resonance as signal spark metadata", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("I keep returning to studios with huge north-facing windows");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    expect(textarea).not.toBeNull();
    await act(async () => {
      textarea?.setSelectionRange(20, 58);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capHighlight")?.click();
    });
    await act(async () => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>("#capResonance button") ?? [])
        .find((button) => button.textContent?.includes("I want this"))
        ?.click();
    });

    await clickQuickSave();

    const metadataNote = `capture_metadata:v1:${JSON.stringify({
      reason: "want",
      reasonLabel: "I want this",
      userReason: null,
    })}`;
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
          note: metadataNote,
        },
      ],
    });
    expect(container?.querySelector("#capConfirm")?.textContent).toContain(
      "Tiny mirror, not a verdict: the marked part is carrying the charge.",
    );
    expect(window.localStorage.getItem("waka.captureDraft.v1")).toBeNull();
  });

  it("offers a one-tap reason and optional micro-answer without blocking save", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("A tiny studio ritual I want to borrow");
    });
    await act(async () => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>("#capResonance button") ?? [])
        .find((button) => button.textContent?.includes("this scared me"))
        ?.click();
    });

    expect(container?.querySelector("#capResonanceNote")?.getAttribute("placeholder")).toBe(
      "Optional. Keep it tiny.",
    );
    expect(container?.querySelector("label.cap-resonance-note")?.textContent).toContain(
      "What feels at stake?",
    );

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "A tiny studio ritual I want to borrow",
      kind: "note",
      sparks: [
        {
          text: "A tiny studio ritual I want to borrow",
          source: "user_written",
          startOffset: undefined,
          endOffset: undefined,
          confidence: 90,
          isPrimary: true,
          note: `capture_metadata:v1:${JSON.stringify({
            reason: "scared",
            reasonLabel: "this scared me",
            userReason: null,
          })}`,
        },
      ],
    });
    expect(createReflection).not.toHaveBeenCalled();
    expect(container?.querySelector("#capConfirm")?.textContent).toContain(
      "Tiny mirror, not a verdict: this reads like this scared me.",
    );
    expect(container?.querySelector(".cap-save-mirror-actions")?.textContent).toContain("keep");
    expect(container?.querySelector(".cap-save-mirror-actions")?.textContent).toContain("adjust");
    expect(container?.querySelector(".cap-save-mirror-actions")?.textContent).toContain("just save");
  });

  it("lets the user adjust after the non-final mirror without losing the saved text", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("This private weather needs one more pass");
    });

    await clickQuickSave();
    await act(async () => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>(".cap-save-mirror-actions button") ?? [])
        .find((button) => button.textContent === "adjust")
        ?.click();
    });

    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe(
      "This private weather needs one more pass",
    );
  });

  it("persists the optional reason note as stronger user-provided capture metadata", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("This operating cadence feels expensive but clarifying");
    });
    await act(async () => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>("#capResonance button") ?? [])
        .find((button) => button.textContent?.includes("I want to build toward this"))
        ?.click();
    });
    const noteInput = container?.querySelector<HTMLInputElement>("#capResonanceNote");
    expect(noteInput).not.toBeNull();
    await act(async () => {
      if (noteInput) noteInput.value = "This might change what I commit to next.";
      noteInput?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      noteInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "This operating cadence feels expensive but clarifying",
      kind: "note",
      sparks: [
        expect.objectContaining({
          source: "user_written",
          confidence: 90,
          note: `capture_metadata:v1:${JSON.stringify({
            reason: "build_toward_this",
            reasonLabel: "I want to build toward this",
            userReason: "This might change what I commit to next.",
          })}`,
        }),
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

  it("localizes capture action tooltips and removable chip labels in Korean", async () => {
    await renderCaptureForm({ locale: "ko-KR" });
    await pasteText("https://example.com/article");

    expect(container?.querySelector<HTMLButtonElement>("#capReflectiveSave")?.title).toBe(
      "이 신호를 저장하기 전에 개인 리플렉션 하나 추가",
    );
    expect(container?.querySelector<HTMLButtonElement>("#capSave")?.title).toBe("맥락을 추가하지 않고 이 신호 저장");
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
      inspiration({ kind: "image", text: "Image signal" }),
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
      text: "Image signal",
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

  it("keeps the saved signal and reports recovery copy when attachment finalization partially fails", async () => {
    vi.mocked(createInspiration).mockResolvedValue(inspiration({ kind: "link", text: "Link signal" }));
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
      "Saved — 1 attachment failed. Your signal is still in history.",
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

describe("CaptureForm Process journey", () => {
  it("enters reflection only from Process and saves the reflection separately on Continue", async () => {
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

    const answer = container?.querySelector<HTMLTextAreaElement>("#reflectAns");
    expect(answer).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(answer, "It connects to the next project.");
      answer?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const continueButton = container?.querySelector<HTMLButtonElement>("#reflectNext");
    await act(async () => {
      continueButton?.click();
    });
    await flushReactWork();
    await flushReactWork();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "Process this richer input",
      kind: "note",
    });
    expect(createReflection).toHaveBeenCalledWith("insp-new", {
      question: "What did this mean to you?",
      answer: "It connects to the next project.",
      skipped: false,
    });
  });
});
