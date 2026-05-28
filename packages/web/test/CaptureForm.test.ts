// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInspiration,
  createReflection,
  finalizeAttachment,
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

async function renderCaptureForm(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(CaptureForm));
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
  vi.mocked(createInspiration).mockResolvedValue(inspiration());
  vi.mocked(createReflection).mockResolvedValue({
    reflection: {
      id: "reflection-1",
      inspirationId: "insp-new",
      userId: "user-1",
      question: "What about this is worth remembering?",
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
});

describe("CaptureForm multi-input quick capture", () => {
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

  it("quick saves an attachment-only image as kind image through the existing upload/finalize path", async () => {
    vi.mocked(createInspiration).mockResolvedValue(
      inspiration({ kind: "image", text: "(attachment-only inspiration)" }),
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
      text: "(attachment-only inspiration)",
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
      question: "What about this is worth remembering?",
      answer: "It connects to the next project.",
      skipped: false,
    });
  });
});
