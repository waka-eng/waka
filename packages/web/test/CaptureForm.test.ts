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
      "What caught your attention?",
    );
    const attachButton = container?.querySelector<HTMLButtonElement>(".cap-file-btn");
    const reflectArea = container?.querySelector<HTMLElement>("#reflectArea");
    expect(attachButton?.tagName).toBe("BUTTON");
    expect(attachButton?.getAttribute("aria-label")).toBe("attach an image");
    expect(attachButton?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(reflectArea?.hidden).toBe(true);
    expect(reflectArea?.getAttribute("aria-hidden")).toBe("true");
    expect(reflectArea?.hasAttribute("inert")).toBe(true);
    expect(container?.querySelector("#capResonance")).toBeNull();
    expect(container?.querySelector("#capDraftState")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#capSave")?.textContent).toContain("Save it now");
    expect(container?.querySelector("#capReflectiveSave")).toBeNull();
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

    const restored: HTMLDivElement = await renderCaptureForm();

    expect(restored.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe(
      "A private draft that should not disappear",
    );
    expect(restored.querySelector("#capDraftState")).toBeNull();
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

  it("does not create highlight UI or selected-text spark metadata from text selection", async () => {
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
    expect(container?.querySelector(".cap-selection-toolbar")).toBeNull();
    expect(container?.querySelector(".cap-note-highlight-layer")).toBeNull();
    expect(container?.querySelector(".cap-highlight-mode")).toBeNull();

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "I keep returning to studios with huge north-facing windows",
      kind: "note",
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
    expect(window.localStorage.getItem("waka.captureDraft.v1")).toBeNull();
  });

  it("expands into a full-page writing environment without changing the draft", async () => {
    // The expand/collapse control sits with the attach button on the left of
    // the capture bar; toggling it asks the parent to flip focus mode.
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

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capExpand")?.click();
    });
    expect(toggleFocus).toHaveBeenCalledWith(true);
    await rerender(true);
    expect(container?.querySelector(".cell.capture")?.className).toContain("focused");
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("Keep the open studio table safe");
    expect(container?.querySelector(".cap-note-highlight-layer")).toBeNull();

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#capExpand")?.click();
    });
    expect(toggleFocus).toHaveBeenLastCalledWith(false);
    await rerender(false);
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("Keep the open studio table safe");
    expect(container?.querySelector(".cap-note-highlight-layer")).toBeNull();
  });

  it("confirms a durable quick save before offering optional reflection", async () => {
    const onSaved = vi.fn();
    await renderCaptureForm({ onSaved });
    await act(async () => {
      setText("This private weather needs one more pass");
    });

    await clickQuickSave();

    // No in-cell post-save mirror; the form shows an explicit save confirmation,
    // then lets the user dismiss or optionally reflect deeper.
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
    expect(container?.querySelector("#capConfirm")?.textContent).toContain("Inspiration saved.");
    expect(container?.querySelector("#reflectArea")?.className).toContain("visible");
    expect(container?.querySelector<HTMLElement>("#reflectArea")?.hidden).toBe(false);
    expect(container?.querySelector("#reflectArea")?.hasAttribute("inert")).toBe(false);
    expect(container?.querySelector<HTMLElement>("#capBody")?.hidden).toBe(true);
    expect(container?.querySelector("#reflectQ")?.textContent).toContain("Why did this matter right now?");
    expect(container?.querySelector<HTMLButtonElement>("#reflectLater")?.textContent).toContain("Done");
    expect(container?.querySelector<HTMLButtonElement>("#reflectNext")?.textContent).toContain("Reflect deeper");
    expect(createReflection).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // The note is cleared so a fresh capture can start.
    expect(container?.querySelector<HTMLTextAreaElement>("#capNote")?.value).toBe("");

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectLater")?.click();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("saves Reflect deeper only after the inspiration is already persisted", async () => {
    vi.mocked(createInspiration).mockResolvedValue(inspiration({ id: "insp-post-save" }));
    const onSaved = vi.fn();
    await renderCaptureForm({ onSaved });
    await act(async () => {
      setText("A messy thing I want safe before I understand it");
    });

    expect(container?.querySelector("#capReflectiveSave")).toBeNull();
    await clickQuickSave();
    expect(createInspiration).toHaveBeenCalledTimes(1);
    expect(createInspiration).toHaveBeenCalledWith({
      text: "A messy thing I want safe before I understand it",
      kind: "note",
    });
    expect(createReflection).not.toHaveBeenCalled();

    await act(async () => {
      setReflectText("Book one hour tomorrow.");
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#reflectNext")?.click();
    });
    await flushReactWork();

    expect(createReflection).toHaveBeenCalledWith("insp-post-save", {
      question: "Why did this matter right now?",
      answer: "Book one hour tomorrow.",
      skipped: false,
    });
    expect(container?.querySelector(".cap-save-mirror")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("ignores selected passages when saving a plain note", async () => {
    await renderCaptureForm();
    await act(async () => {
      setText("I want to build toward this operating cadence");
    });
    const textarea = container?.querySelector<HTMLTextAreaElement>("#capNote");
    await act(async () => {
      textarea?.setSelectionRange(0, "I want to build toward this".length);
      textarea?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(container?.querySelector(".cap-selection-toolbar")).toBeNull();

    await clickQuickSave();

    expect(createInspiration).toHaveBeenCalledWith({
      text: "I want to build toward this operating cadence",
      kind: "note",
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

  it("localizes capture action tooltips, draft copy, and removable chip labels in Korean", async () => {
    await renderCaptureForm({ locale: "ko-KR" });
    await pasteText("https://example.com/article");

    expect(container?.querySelector("#capDraftState")).toBeNull();
    expect(container?.querySelector("#capReflectiveSave")).toBeNull();
    expect(container?.querySelector<HTMLButtonElement>("#capSave")?.title).toBe("이 영감을 지금 저장");
    expect(container?.querySelector<HTMLButtonElement>(".att-x")?.getAttribute("aria-label")).toBe("첨부 제거");
  });

  it("quick saves a plain note as kind note before opening optional reflection", async () => {
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
    expect(container?.querySelector("#reflectArea")?.className).toContain("visible");
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


